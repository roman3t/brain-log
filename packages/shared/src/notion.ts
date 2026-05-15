import { Client } from '@notionhq/client'
import { config } from './config'

export type CaptureType = 'note' | 'todo' | 'vibe' | 'learn'
export type CaptureSource = 'cli' | 'browser'

export interface Capture {
  type: CaptureType
  raw: string
  source: CaptureSource
  processed?: string
  date?: string
  task?: string
}

export interface Recap {
  date: string
  whatIDid: string
  whatILearned: string
  tomorrow: string
}

let _client: Client | null = null

function getClient(): Client {
  if (!_client) {
    _client = new Client({ auth: config.notion.token })
  }
  return _client
}

export async function saveCapture(capture: Capture): Promise<string> {
  const client = getClient()
  const today = capture.date || new Date().toISOString().split('T')[0]
  const namePrefix = capture.task ? `[${capture.task}] ` : ''
  const name = `${namePrefix}${capture.type}: ${capture.raw.slice(0, 50)}${capture.raw.length > 50 ? '...' : ''}`

  const baseProperties: any = {
    Name: { title: [{ text: { content: name } }] },
    Date: { date: { start: today } },
    Type: { select: { name: capture.type } },
    Raw: { rich_text: [{ text: { content: capture.raw } }] },
    Source: { select: { name: capture.source } },
    ...(capture.processed && {
      Processed: { rich_text: [{ text: { content: capture.processed } }] },
    }),
  }

  const propertiesWithTask = {
    ...baseProperties,
    ...(capture.task && {
      Task: { rich_text: [{ text: { content: capture.task } }] },
    }),
  }

  try {
    const response = await client.pages.create({
      parent: { database_id: config.notion.databases.captures },
      properties: propertiesWithTask,
    })
    return response.id
  } catch (e: any) {
    if (capture.task && e.status === 400) {
      const response = await client.pages.create({
        parent: { database_id: config.notion.databases.captures },
        properties: baseProperties,
      })
      return response.id
    }
    throw e
  }
}

export async function saveRecap(recap: Recap): Promise<string> {
  const client = getClient()

  const response = await client.pages.create({
    parent: { database_id: config.notion.databases.recaps },
    properties: {
      Name: { title: [{ text: { content: `Recap ${recap.date}` } }] },
      Date: { date: { start: recap.date } },
      'What I did': { rich_text: [{ text: { content: recap.whatIDid } }] },
      'What I learned': { rich_text: [{ text: { content: recap.whatILearned } }] },
      Tomorrow: { rich_text: [{ text: { content: recap.tomorrow } }] },
    },
  })

  return response.id
}

export interface TrackedTask {
  notionPageId: string
  taskId: string
  title: string
  status: string
  priority: string
  assignee: string
  url: string
}

export async function setupTasksDatabase(parentPageId: string): Promise<string> {
  const client = getClient()

  const db = await (client.databases as any).create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Tasks' } }],
    properties: {
      Name:          { title: {} },
      'Task ID':     { rich_text: {} },
      Status:        { select: { options: [
        { name: 'To Do', color: 'gray' },
        { name: 'In Progress', color: 'blue' },
        { name: 'DOING', color: 'orange' },
        { name: 'In Review', color: 'yellow' },
        { name: 'Done', color: 'green' },
        { name: 'Blocked', color: 'red' },
      ]}},
      Priority:      { select: { options: [
        { name: 'Highest', color: 'red' },
        { name: 'High', color: 'orange' },
        { name: 'Medium', color: 'yellow' },
        { name: 'Low', color: 'blue' },
        { name: 'Lowest', color: 'gray' },
      ]}},
      Assignee:      { rich_text: {} },
      URL:           { url: {} },
      Added:         { date: {} },
      'Last Synced': { date: {} },
    },
  })

  return db.id.replace(/-/g, '')
}

function toNotionBlocks(text: string): any[] {
  if (!text) return []
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
      },
    }))
}

export async function upsertTrackedTask(issue: {
  id: string; title: string; status: string; priority: string; assignee: string; url: string; description?: string
}): Promise<void> {
  const client = getClient()
  const dbId = config.notion.databases.tasks
  if (!dbId) return

  const now = new Date().toISOString().split('T')[0]

  const existing = await client.databases.query({
    database_id: dbId,
    filter: { property: 'Task ID', rich_text: { equals: issue.id } },
  })

  const properties: any = {
    Name:          { title: [{ text: { content: `${issue.id} — ${issue.title}` } }] },
    'Task ID':     { rich_text: [{ text: { content: issue.id } }] },
    Status:        { select: { name: issue.status || 'To Do' } },
    Priority:      { select: { name: issue.priority || 'Medium' } },
    Assignee:      { rich_text: [{ text: { content: issue.assignee } }] },
    URL:           { url: issue.url || null },
    'Last Synced': { date: { start: now } },
  }

  if (existing.results.length > 0) {
    await (client.pages as any).update({ page_id: existing.results[0].id, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: dbId },
      properties: { ...properties, Added: { date: { start: now } } },
    }) as any
    if (issue.description) {
      const blocks = toNotionBlocks(issue.description)
      if (blocks.length > 0) {
        await (client.blocks as any).children.append({ block_id: page.id, children: blocks.slice(0, 100) })
      }
    }
  }
}

export async function getTrackedTasks(): Promise<TrackedTask[]> {
  const client = getClient()
  const dbId = config.notion.databases.tasks
  if (!dbId) return []

  const response = await client.databases.query({ database_id: dbId })

  return response.results.map((page: any) => ({
    notionPageId: page.id,
    taskId: page.properties['Task ID']?.rich_text?.[0]?.plain_text || '',
    title: page.properties.Name?.title?.[0]?.plain_text || '',
    status: page.properties.Status?.select?.name || '',
    priority: page.properties.Priority?.select?.name || '',
    assignee: page.properties.Assignee?.rich_text?.[0]?.plain_text || '',
    url: page.properties.URL?.url || '',
  }))
}

export async function getCapturesForToday(): Promise<Capture[]> {
  const client = getClient()
  const today = new Date().toISOString().split('T')[0]

  const response = await client.databases.query({
    database_id: config.notion.databases.captures,
    filter: {
      property: 'Date',
      date: { equals: today },
    },
    sorts: [{ property: 'Date', direction: 'ascending' }],
  })

  return response.results.map((page: any) => ({
    type: page.properties.Type?.select?.name as CaptureType,
    raw: page.properties.Raw?.rich_text?.[0]?.plain_text || '',
    source: page.properties.Source?.select?.name as CaptureSource,
    processed: page.properties.Processed?.rich_text?.[0]?.plain_text,
    date: page.properties.Date?.date?.start,
    task: page.properties.Task?.rich_text?.[0]?.plain_text,
  }))
}
