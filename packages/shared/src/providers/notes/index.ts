import type { NotesProvider, Capture, Recap } from './types'
import { MarkdownProvider } from './markdown'
import { NotionProvider } from './notion'
import { gitSync } from './git-sync'
import { config } from '../../config'

export function getNotesProvider(override?: string): NotesProvider {
  const name = override || config.notes.default || 'markdown'
  switch (name) {
    case 'notion': return new NotionProvider()
    case 'markdown': return new MarkdownProvider()
    default: throw new Error(`Notes provider desconocido: "${name}". Opciones: markdown, notion`)
  }
}

export async function saveCapture(capture: Capture): Promise<string> {
  const primary = getNotesProvider()
  const result = await primary.saveCapture(capture)

  if (primary.name === 'markdown' && config.markdown.vaultPath) {
    gitSync(config.markdown.vaultPath).catch(err => {
      if (!err.message?.includes('nothing to commit')) {
        console.error(`[brain-log] Git sync failed (non-blocking): ${err.message}`)
      }
    })
  }

  if (primary.name !== 'notion' && config.notion.token) {
    new NotionProvider().saveCapture(capture).catch(err => {
      console.error(`[brain-log] Notion sync failed (non-blocking): ${err.message}`)
    })
  }

  return result
}

export async function saveRecap(recap: Recap): Promise<string> {
  const primary = getNotesProvider()
  const result = await primary.saveRecap(recap)

  if (primary.name === 'markdown' && config.markdown.vaultPath) {
    gitSync(config.markdown.vaultPath).catch(err => {
      if (!err.message?.includes('nothing to commit')) {
        console.error(`[brain-log] Git sync failed (non-blocking): ${err.message}`)
      }
    })
  }

  if (primary.name !== 'notion' && config.notion.token) {
    new NotionProvider().saveRecap(recap).catch(err => {
      console.error(`[brain-log] Notion sync failed (non-blocking): ${err.message}`)
    })
  }

  return result
}

export async function getCapturesForToday(): Promise<Capture[]> {
  return getNotesProvider().getCapturesForToday()
}

export async function getCapturesForDate(date: string): Promise<Capture[]> {
  return getNotesProvider().getCapturesForDate(date)
}

export * from './types'
export { MarkdownProvider, NotionProvider }
export { gitSync } from './git-sync'
