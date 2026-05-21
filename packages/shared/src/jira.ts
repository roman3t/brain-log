import { config } from './config'

export interface JiraIssue {
  id: string
  title: string
  status: string
  url: string
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
    return { id: issueKey, title: issueKey, status: '', url: '' }
  }

  const { auth } = getAuth()
  const res = await fetch(`https://${host}/rest/api/3/issue/${issueKey}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  })

  if (!res.ok) throw new Error(`Jira: no se encontró el issue ${issueKey} (${res.status})`)

  const data = await res.json() as any
  return {
    id: data.key,
    title: data.fields.summary,
    status: data.fields.status.name,
    url: `https://${host}/browse/${issueKey}`,
  }
}

export interface JiraDeployment {
  environment: string
  environmentType: string
  state: string
  displayName: string
  lastUpdated: string
}

export async function getJiraDeployments(issueKey: string): Promise<JiraDeployment[]> {
  const { host, email, token } = config.jira
  if (!host || !email || !token) return []

  const { auth } = getAuth()
  const res = await fetch(
    `https://${host}/rest/deployments/0.1/bulk?issueKeys=${issueKey}`,
    { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
  )

  if (!res.ok) return []

  const data = await res.json() as any
  return (data.deployments || []).map((d: any) => ({
    environment: d.environment?.displayName || '',
    environmentType: d.environment?.type || '',
    state: d.state || '',
    displayName: d.displayName || '',
    lastUpdated: d.lastUpdated || '',
  }))
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
