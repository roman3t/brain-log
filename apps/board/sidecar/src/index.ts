/**
 * Sidecar: proceso Node que expone @brain-log/shared al shell de Tauri.
 *
 * Existe para que las llamadas a Jira y GitLab sigan viviendo en el código
 * TypeScript ya probado del monorepo en vez de reimplementarse en Rust, sin
 * que por eso el token llegue al webview.
 *
 * Contrato con el proceso Rust:
 *   1. Rust lanza este proceso con los secretos en el entorno (leídos del
 *      keychain) y BOARD_SIDECAR_TOKEN.
 *   2. El sidecar escucha en 127.0.0.1 en un puerto efímero.
 *   3. Escribe una línea de handshake en stdout: BOARD_SIDECAR_READY {json}
 *   4. Rust lee el puerto de ahí y actúa de proxy. El webview nunca habla
 *      con este servidor directamente.
 *
 * dotenv en config.ts es first-wins: lo que Rust inyecta gana sobre
 * ~/.brain-log/.env, que queda como fallback de desarrollo.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getPMProvider } from '@brain-log/shared'
import { listTodos, toggleTodo, type ToggleRequest } from './todos'
import { listActivity, whoami as gitlabWhoami } from './gitlab'

const TOKEN = process.env.BOARD_SIDECAR_TOKEN
if (!TOKEN) {
  console.error('[sidecar] BOARD_SIDECAR_TOKEN no definido; el proceso Rust debe inyectarlo')
  process.exit(1)
}

/** Columnas del tablero. Sale de env para no repetir el hardcodeo del CLI. */
const COLUMNS = (process.env.BOARD_COLUMNS || 'TO DO,DOING,TESTING DEV,TESTING QA,TESTING PROD,DEPLOY TO PROD,HOLD')
  .split(',')
  .map(c => c.trim())
  .filter(Boolean)

type Handler = (params: Record<string, unknown>) => Promise<unknown>

const methods: Record<string, Handler> = {
  /** Sonda de vida. No toca la red ni credenciales. */
  async health() {
    return { ok: true, pid: process.pid }
  },

  /**
   * Tablero de Jira agrupado por columna.
   * Usa la capa PMProvider, no jira.ts directo, para no casarse con Jira.
   */
  async 'board.get'() {
    const provider = getPMProvider()
    const board = await provider.getBoard(COLUMNS)
    return board
  },

  /**
   * Todos del vault, ya correlacionados por clave de issue.
   * Fuente distinta a Jira: falla de forma independiente.
   */
  async 'todos.list'() {
    return { todos: await listTodos() }
  },

  /**
   * Marca o desmarca una casilla en el vault.
   * Escribe en el Markdown; la caché local no participa.
   */
  async 'todos.toggle'(params) {
    return toggleTodo(params as unknown as ToggleRequest)
  },

  /**
   * Actividad de código reciente desde GitLab.
   * Tercera fuente independiente: falla sin arrastrar a Jira ni al vault.
   */
  async 'activity.list'() {
    return { activity: await listActivity() }
  },

  /**
   * Identidad de la cuenta de Jira. Comprueba que la credencial sirve de
   * verdad: tener un token guardado no es lo mismo que que funcione.
   */
  async 'jira.whoami'() {
    // getCurrentUser devuelve { id, name }; al frontend sólo le interesa el nombre.
    const user = await getPMProvider().getCurrentUser()
    return { account: user.name }
  },

  /** Identidad de la cuenta de GitLab. */
  async 'gitlab.whoami'() {
    const user = await gitlabWhoami()
    return { account: user.name ? `${user.name} (@${user.username})` : user.username }
  },
}

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Nunca devolvemos el error crudo del proveedor: puede traer la URL
 * autenticada o el header Authorization. Se recorta a tipo + mensaje.
 */
function safeError(err: unknown): { kind: string; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  // Los errores que ya traen un `kind` propio (p. ej. la divergencia al
  // escribir un todo) lo conservan: clasificarlos por el texto los degradaría.
  if (err && typeof err === 'object' && 'kind' in err && typeof err.kind === 'string') {
    return { kind: err.kind, message }
  }
  const redacted = message
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic [redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/(PRIVATE-TOKEN|api_token|token)=[^\s&]+/gi, '$1=[redacted]')
  if (/401|403|unauthor/i.test(redacted)) return { kind: 'auth', message: redacted }
  if (/429|rate limit/i.test(redacted)) return { kind: 'rate_limit', message: redacted }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(redacted)) {
    return { kind: 'offline', message: redacted }
  }
  return { kind: 'unknown', message: redacted }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    // El sidecar sólo recibe consultas pequeñas; un cuerpo grande es un bug o un abuso.
    if (size > 1_000_000) throw new Error('cuerpo demasiado grande')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/rpc') {
    return send(res, 404, { ok: false, error: { kind: 'not_found', message: 'usa POST /rpc' } })
  }

  const auth = req.headers.authorization
  if (auth !== `Bearer ${TOKEN}`) {
    return send(res, 401, { ok: false, error: { kind: 'auth', message: 'token de sidecar inválido' } })
  }

  let method: string
  let params: Record<string, unknown>
  try {
    const parsed = JSON.parse(await readBody(req))
    method = String(parsed.method || '')
    params = (parsed.params ?? {}) as Record<string, unknown>
  } catch (err) {
    return send(res, 400, { ok: false, error: safeError(err) })
  }

  const handler = methods[method]
  if (!handler) {
    return send(res, 404, { ok: false, error: { kind: 'not_found', message: `método desconocido: ${method}` } })
  }

  try {
    const data = await handler(params)
    send(res, 200, { ok: true, data })
  } catch (err) {
    // Log del lado del sidecar sin el token; Rust lo reenvía al frontend ya recortado.
    const safe = safeError(err)
    console.error(`[sidecar] ${method} falló (${safe.kind}): ${safe.message}`)
    send(res, 200, { ok: false, error: safe })
  }
})

// Puerto 0 = el SO asigna uno libre. Sólo loopback: nadie fuera de la máquina entra.
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    console.error('[sidecar] no se pudo determinar el puerto')
    process.exit(1)
  }
  // Handshake que Rust espera en stdout. El token no viaja aquí: Rust ya lo tiene.
  process.stdout.write(`BOARD_SIDECAR_READY ${JSON.stringify({ port: address.port })}\n`)
})

// Si Rust muere, el sidecar no debe quedar huérfano sosteniendo un puerto.
process.stdin.on('close', () => process.exit(0))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
