/**
 * Historial de tickets desde Jira.
 *
 * Va aparte de `searchJiraIssues` por dos motivos: ese cliente no pide
 * `resolutiondate` ni `updated`, y ante un error corta y devuelve lo que lleve,
 * lo que aquí se leería como "no tienes tickets" en lugar de "Jira falló".
 */
import { config } from '@brain-log/shared'

export type TaskCategory = 'todo' | 'in_progress' | 'done'

export interface HistoryTask {
  key: string
  title: string
  status: string
  category: TaskCategory
  assignee: string | null
  url: string
  updatedAt: string
  /** Cuándo se resolvió. null si sigue abierto. */
  resolvedAt: string | null
}

export interface JiraRawIssue {
  key: string
  fields?: {
    summary?: string
    updated?: string
    resolutiondate?: string | null
    assignee?: { displayName?: string } | null
    status?: { name?: string; statusCategory?: { key?: string } }
  }
}

/**
 * `was` incluye al asignado actual y a quienes lo fueron: un ticket que pasó a
 * QA con otra persona también es trabajo hecho. Configurable porque el prefijo
 * del proyecto no aplica a todos los contextos.
 */
const historyJql = () =>
  process.env.BOARD_HISTORY_JQL ||
  'project = GCD AND assignee was currentUser() ORDER BY updated DESC'

function categoryOf(key?: string): TaskCategory {
  if (key === 'done') return 'done'
  if (key === 'indeterminate') return 'in_progress'
  return 'todo'
}

export function normalizeTask(raw: JiraRawIssue, host: string): HistoryTask {
  const fields = raw.fields ?? {}
  return {
    key: raw.key,
    title: fields.summary || '(sin título)',
    status: fields.status?.name || '(sin estado)',
    category: categoryOf(fields.status?.statusCategory?.key),
    assignee: fields.assignee?.displayName || null,
    url: `https://${host}/browse/${raw.key}`,
    updatedAt: fields.updated || '',
    resolvedAt: fields.resolutiondate || null,
  }
}

export async function listHistoryTasks(): Promise<HistoryTask[]> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) throw new Error('Jira 401: credenciales no configuradas')

  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const tasks: HistoryTask[] = []
  let nextPageToken: string | undefined

  do {
    const res = await fetch(`https://${host}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jql: historyJql(),
        fields: ['summary', 'status', 'assignee', 'updated', 'resolutiondate'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    })
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`)

    const data = (await res.json()) as { issues?: JiraRawIssue[]; nextPageToken?: string; isLast?: boolean }
    for (const issue of data.issues ?? []) tasks.push(normalizeTask(issue, host))
    nextPageToken = data.isLast ? undefined : data.nextPageToken
  } while (nextPageToken)

  return tasks
}
