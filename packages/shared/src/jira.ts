import { config } from './config'

export interface JiraIssue {
  id: string
  numericId: string
  title: string
  status: string
  url: string
}

export interface JiraPullRequest {
  title: string
  status: string
  sourceBranch: string
  targetBranch: string
  url: string
  lastUpdated: string
}

export interface JiraIssueDetail extends JiraIssue {
  type: string
  priority: string
  assignee: string
  description: string
  comments: { author: string; body: string; created: string }[]
}

function adfToText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'mention') return `@${node.attrs?.text || ''}`
  if (node.content) {
    const text = node.content.map(adfToText).join('')
    if (['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList'].includes(node.type)) {
      return text + '\n'
    }
    return text
  }
  return ''
}

function getAuth() {
  const { host, email, token } = config.jira
  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  return { host, auth }
}

export async function getJiraIssue(issueKey: string): Promise<JiraIssue> {
  const { host, email, token } = config.jira

  if (!host || !email || !token) {
    return { id: issueKey, numericId: '', title: issueKey, status: '', url: '' }
  }

  const { auth } = getAuth()
  const res = await fetch(`https://${host}/rest/api/3/issue/${issueKey}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })

  if (!res.ok) throw new Error(`Jira: no se encontró el issue ${issueKey} (${res.status})`)

  const data = await res.json() as any
  return {
    id: data.key,
    numericId: data.id,
    title: data.fields.summary,
    status: data.fields.status.name,
    url: `https://${host}/browse/${issueKey}`,
  }
}

export interface JiraDevSummary {
  pullRequests: { count: number; state: string }
  deployments: { count: number }
  builds: { count: number; successful: number }
  instanceTypes: string[]
}

export async function getJiraDevSummary(numericId: string): Promise<JiraDevSummary> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) return { pullRequests: { count: 0, state: '' }, deployments: { count: 0 }, builds: { count: 0, successful: 0 }, instanceTypes: [] }

  const { auth } = getAuth()
  const res = await fetch(
    `https://${host}/rest/dev-status/1.0/issue/summary?issueId=${numericId}`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )

  if (!res.ok) return { pullRequests: { count: 0, state: '' }, deployments: { count: 0 }, builds: { count: 0, successful: 0 }, instanceTypes: [] }

  const data = await res.json() as any
  const s = data.summary || {}
  const instanceTypes = Object.keys(s.pullrequest?.byInstanceType || {})

  return {
    pullRequests: { count: s.pullrequest?.overall?.count || 0, state: s.pullrequest?.overall?.state || '' },
    deployments: { count: s['deployment-environment']?.overall?.count || 0 },
    builds: { count: s.build?.overall?.count || 0, successful: s.build?.overall?.successfulBuildCount || 0 },
    instanceTypes,
  }
}

export async function getJiraPullRequests(numericId: string): Promise<JiraPullRequest[]> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) return []

  const { auth } = getAuth()

  const summary = await getJiraDevSummary(numericId)
  if (summary.instanceTypes.length === 0) return []

  const prs: JiraPullRequest[] = []

  for (const appType of summary.instanceTypes) {
    const res = await fetch(
      `https://${host}/rest/dev-status/1.0/issue/detail?issueId=${numericId}&applicationType=${encodeURIComponent(appType)}&dataType=pullrequest`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
    )
    if (!res.ok) continue

    const data = await res.json() as any
    for (const detail of (data.detail || [])) {
      for (const pr of (detail.pullRequests || [])) {
        prs.push({
          title: pr.name || '',
          status: pr.status || '',
          sourceBranch: pr.source?.branch || '',
          targetBranch: pr.destination?.branch || '',
          url: pr.url || '',
          lastUpdated: pr.lastUpdate || '',
        })
      }
    }
  }

  return prs
}

export interface JiraDeployment {
  environment: string
  environmentType: string
  state: string
  displayName: string
  lastUpdated: string
}

export async function getJiraDeployments(numericId: string): Promise<JiraDeployment[]> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) return []

  const { auth } = getAuth()
  const res = await fetch(
    `https://${host}/rest/dev-status/1.0/issue/detail?issueId=${numericId}&dataType=deployment`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )

  if (!res.ok) return []

  const data = await res.json() as any
  const deployments: JiraDeployment[] = []

  for (const detail of (data.detail || [])) {
    for (const d of (detail.deployments || [])) {
      deployments.push({
        environment: d.environment?.displayName || '',
        environmentType: d.environment?.type || '',
        state: d.state || '',
        displayName: d.displayName || '',
        lastUpdated: d.lastUpdated || '',
      })
    }
  }

  return deployments
}

export async function wasMovedBackward(
  issueKey: string,
  pipeline: string[],
): Promise<{ backward: boolean; movedAt?: string }> {
  const { host, auth } = getAuth()

  const countRes = await fetch(
    `https://${host}/rest/api/3/issue/${issueKey}/changelog?maxResults=1`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )
  if (!countRes.ok) return { backward: false }
  const { total } = await countRes.json() as any

  const startAt = Math.max(0, total - 10)
  const res = await fetch(
    `https://${host}/rest/api/3/issue/${issueKey}/changelog?maxResults=10&startAt=${startAt}`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )
  if (!res.ok) return { backward: false }

  const data = await res.json() as any
  const statusChanges = (data.values || [])
    .flatMap((entry: any) => entry.items
      .filter((i: any) => i.field === 'status')
      .map((i: any) => ({
        from: i.fromString as string,
        to: i.toString as string,
        createdAt: entry.created as string,
      }))
    )

  if (statusChanges.length === 0) return { backward: false }

  const last = statusChanges[statusChanges.length - 1]
  const pipelineLower = pipeline.map(s => s.toLowerCase())
  const fromIdx = pipelineLower.indexOf(last.from?.toLowerCase())
  const toIdx = pipelineLower.indexOf(last.to?.toLowerCase())

  const backward = fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx
  return backward ? { backward: true, movedAt: last.createdAt } : { backward: false }
}

export async function getJiraCurrentUser(): Promise<{ accountId: string; displayName: string }> {
  const { host, auth } = getAuth()
  const res = await fetch(`https://${host}/rest/api/3/myself`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error('No se pudo obtener el usuario actual de Jira')
  const data = await res.json() as any
  return { accountId: data.accountId, displayName: data.displayName }
}

export async function assignJiraIssue(issueKey: string, accountId: string): Promise<void> {
  const { host, auth } = getAuth()
  const res = await fetch(`https://${host}/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  })
  if (!res.ok) throw new Error(`Jira: error al asignar ${issueKey} (${res.status})`)
}

export async function getJiraTransitions(issueKey: string): Promise<{ id: string; name: string }[]> {
  const { host, auth } = getAuth()
  const res = await fetch(`https://${host}/rest/api/3/issue/${issueKey}/transitions`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira: no se pudieron obtener transiciones para ${issueKey}`)
  const data = await res.json() as any
  return (data.transitions || []).map((t: any) => ({ id: t.id, name: t.name }))
}

export async function transitionJiraIssue(issueKey: string, transitionName: string): Promise<string> {
  const { host, auth } = getAuth()

  const res = await fetch(
    `https://${host}/rest/api/3/issue/${issueKey}/transitions`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )
  if (!res.ok) throw new Error(`Jira: no se pudieron obtener transiciones para ${issueKey}`)

  const data = await res.json() as any
  const transitions: { id: string; name: string }[] = data.transitions || []

  const match = transitions.find(t =>
    t.name.toLowerCase().includes(transitionName.toLowerCase()),
  )

  if (!match) {
    const available = transitions.map(t => t.name).join(', ')
    throw new Error(`Transición "${transitionName}" no encontrada. Disponibles: ${available}`)
  }

  const tr = await fetch(
    `https://${host}/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: match.id } }),
    },
  )
  if (!tr.ok) throw new Error(`Jira: error al transicionar ${issueKey} (${tr.status})`)

  return match.name
}

export interface JiraBoardIssue {
  key: string
  numericId: string
  title: string
  status: string
  priority: string
  labels: string[]
  assignee: string
  url: string
}

export async function searchJiraIssues(jql: string): Promise<JiraBoardIssue[]> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) return []

  const { auth } = getAuth()
  const issues: JiraBoardIssue[] = []
  let nextPageToken: string | undefined

  do {
    const body: any = {
      jql,
      fields: ['summary', 'status', 'priority', 'labels', 'assignee'],
      maxResults: 100,
    }
    if (nextPageToken) body.nextPageToken = nextPageToken

    const res = await fetch(`https://${host}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) break

    const data = await res.json() as any
    for (const i of (data.issues || [])) {
      issues.push({
        key: i.key,
        numericId: i.id,
        title: i.fields?.summary || '',
        status: i.fields?.status?.name || '',
        priority: i.fields?.priority?.name || '',
        labels: i.fields?.labels || [],
        assignee: i.fields?.assignee?.displayName || '',
        url: `https://${host}/browse/${i.key}`,
      })
    }

    nextPageToken = data.isLast ? undefined : data.nextPageToken
  } while (nextPageToken)

  return issues
}

export async function getJiraIssueDetail(issueKey: string): Promise<JiraIssueDetail> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) throw new Error('Jira no está configurado en el .env')

  const { auth } = getAuth()
  const res = await fetch(
    `https://${host}/rest/api/3/issue/${issueKey}?fields=summary,status,issuetype,priority,assignee,description,comment`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )

  if (!res.ok) throw new Error(`Jira: no se encontró el issue ${issueKey} (${res.status})`)

  const data = await res.json() as any
  const f = data.fields

  const comments = (f.comment?.comments || []).map((c: any) => ({
    author: c.author?.displayName || 'Unknown',
    body: adfToText(c.body).trim(),
    created: c.created?.split('T')[0] || '',
  }))

  return {
    id: data.key,
    numericId: data.id,
    title: f.summary,
    status: f.status?.name || '',
    url: `https://${host}/browse/${issueKey}`,
    type: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || 'Sin asignar',
    description: adfToText(f.description).trim(),
    comments,
  }
}
