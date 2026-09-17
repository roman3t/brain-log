/**
 * Actividad de código desde GitLab.
 *
 * `GitLabProvider` de @brain-log/shared resuelve el estado de *un* MR dado su
 * URL, que es lo que necesita `brain mr-check`. El board necesita lo contrario:
 * descubrir toda la actividad reciente del usuario sin conocer las URLs de
 * antemano. Por eso aquí se hablan endpoints distintos, manteniendo las mismas
 * convenciones de configuración (`GITLAB_URL`, `GITLAB_TOKEN`, header
 * `PRIVATE-TOKEN`).
 */
import { correlate, extractIssueKey, issuePattern } from './issue-key'

export interface Activity {
  kind: 'merge_request' | 'branch' | 'commit'
  title: string
  /** Ruta del proyecto, p. ej. `gglobal/wms/front/internal`. */
  repo: string
  url: string
  /** Sólo para MRs: opened / merged / closed. */
  state?: string
  /** null significa "no correlacionado". Se muestra como tal, no se adivina. */
  issueKey: string | null
  /**
   * Otras claves mencionadas que contradicen a `issueKey`. La correlación es
   * heurística: cuando las fuentes discrepan se dice, no se elige en silencio.
   */
  conflicts: string[]
  updatedAt: string
}

const baseUrl = () => process.env.GITLAB_URL || 'https://gitlab.com'
const token = () => process.env.GITLAB_TOKEN || ''

/** Cuántos días hacia atrás se considera "actividad reciente". */
const WINDOW_DAYS = Number(process.env.BOARD_ACTIVITY_DAYS || 14)

/**
 * GET con reintento y retroceso exponencial ante límite de tasa.
 *
 * El mensaje de error nunca incluye el token; el header va aparte y el cuerpo
 * de GitLab no lo refleja. Aun así el sidecar recorta el mensaje antes de
 * devolverlo al frontend.
 */
async function get(path: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${baseUrl()}/api/v4${path}`, {
    headers: { 'PRIVATE-TOKEN': token() },
  })

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 3) throw new Error(`GitLab 429: límite de tasa tras ${attempt} reintentos`)
    // GitLab suele mandar Retry-After; si no, 1s, 2s, 4s.
    const retryAfter = Number(res.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2 ** attempt * 1000
    await new Promise(resolve => setTimeout(resolve, delayMs))
    return get(path, attempt + 1)
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`GitLab ${res.status}: credenciales rechazadas`)
  }
  if (!res.ok) {
    throw new Error(`GitLab ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return res.json()
}

/**
 * Identidad del token. Es la comprobación barata de "¿esta credencial sirve?":
 * un token caducado responde 401 aquí igual que en cualquier otro endpoint,
 * pero sin traerse datos.
 */
export async function whoami(): Promise<{ username: string; name?: string }> {
  if (!token()) throw new Error('GitLab 401: GITLAB_TOKEN no configurado')
  const user = (await get('/user')) as { username?: string; name?: string }
  return { username: user.username || '(desconocido)', name: user.name }
}

/** Resuelve project_id -> ruta, cacheando: los eventos sólo traen el id. */
function projectResolver() {
  const cache = new Map<number, string>()
  return async (id: number): Promise<string> => {
    const hit = cache.get(id)
    if (hit) return hit
    try {
      const project = (await get(`/projects/${id}`)) as { path_with_namespace?: string }
      const path = project.path_with_namespace || `proyecto ${id}`
      cache.set(id, path)
      return path
    } catch {
      // Un proyecto ilegible no debe tumbar toda la sincronización.
      cache.set(id, `proyecto ${id}`)
      return `proyecto ${id}`
    }
  }
}

interface GitLabMR {
  title?: string
  description?: string
  state?: string
  source_branch?: string
  web_url?: string
  updated_at?: string
  references?: { full?: string }
}

interface GitLabEvent {
  created_at?: string
  project_id?: number
  push_data?: {
    ref?: string
    ref_type?: string
    commit_title?: string
    commit_to?: string
    commit_count?: number
  }
}

/**
 * Actividad reciente del usuario autenticado: MRs propios, y ramas y commits
 * derivados de sus eventos de push.
 */
export async function listActivity(): Promise<Activity[]> {
  if (!token()) throw new Error('GitLab 401: GITLAB_TOKEN no configurado')

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const sinceIso = since.toISOString()
  const sinceDay = sinceIso.slice(0, 10)
  const pattern = issuePattern()
  const resolveProject = projectResolver()
  const activities: Activity[] = []

  // --- Merge requests propios -------------------------------------------
  // `references.full` ya trae la ruta del proyecto, así que no hace falta
  // resolver el id por separado.
  const mrs = (await get(
    `/merge_requests?scope=created_by_me&state=all&updated_after=${sinceIso}&per_page=50`,
  )) as GitLabMR[]

  for (const mr of mrs) {
    const repo = mr.references?.full?.split('!')[0] || ''
    // La rama manda sobre el texto escrito a mano; si discrepan, se reporta.
    const { issueKey, conflicts } = correlate(mr.source_branch, [mr.title, mr.description], pattern)
    activities.push({
      kind: 'merge_request',
      title: mr.title || '(sin título)',
      repo,
      url: mr.web_url || '',
      state: mr.state,
      issueKey,
      conflicts,
      updatedAt: mr.updated_at || sinceIso,
    })
  }

  // --- Ramas y commits desde eventos de push ----------------------------
  const events = (await get(
    `/events?action=pushed&after=${sinceDay}&per_page=100`,
  )) as GitLabEvent[]

  const seenBranches = new Set<string>()

  for (const event of events) {
    const push = event.push_data
    if (!push || !event.project_id) continue

    const repo = await resolveProject(event.project_id)
    const when = event.created_at || sinceIso

    if (push.ref && push.ref_type === 'branch') {
      // Una rama aparece en cada push; sólo interesa una vez, la más reciente.
      const key = `${repo}@${push.ref}`
      if (!seenBranches.has(key)) {
        seenBranches.add(key)
        activities.push({
          kind: 'branch',
          title: push.ref,
          repo,
          url: `${baseUrl()}/${repo}/-/tree/${encodeURIComponent(push.ref)}`,
          issueKey: extractIssueKey([push.ref], pattern),
          conflicts: [],
          updatedAt: when,
        })
      }
    }

    if (push.commit_title) {
      // Aquí la rama es la fuente fiable y el mensaje el texto libre, igual
      // que en un MR: un commit en la rama GCD-1 que mencione GCD-2 discrepa.
      const { issueKey, conflicts } = correlate(push.ref, [push.commit_title], pattern)
      activities.push({
        kind: 'commit',
        title: push.commit_title,
        repo,
        url: push.commit_to ? `${baseUrl()}/${repo}/-/commit/${push.commit_to}` : '',
        issueKey,
        conflicts,
        updatedAt: when,
      })
    }
  }

  // Más reciente primero, que es como se lee una jornada de trabajo.
  activities.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return activities
}
