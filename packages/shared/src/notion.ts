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

  const response = await client.pages.create({
    parent: { database_id: config.notion.databases.captures },
    properties: {
      Name: {
        title: [{ text: { content: `${capture.type}: ${capture.raw.slice(0, 50)}${capture.raw.length > 50 ? '...' : ''}` } }],
      },
      Date: { date: { start: today } },
      Type: { select: { name: capture.type } },
      Raw: { rich_text: [{ text: { content: capture.raw } }] },
      Source: { select: { name: capture.source } },
      ...(capture.processed && {
        Processed: { rich_text: [{ text: { content: capture.processed } }] },
      }),
    },
  })

  return response.id
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
  }))
}
