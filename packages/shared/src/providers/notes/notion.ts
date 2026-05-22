import type { NotesProvider, Capture, Recap } from './types'
import * as notionLib from '../../notion'

export class NotionProvider implements NotesProvider {
  readonly name = 'notion'

  async saveCapture(capture: Capture): Promise<string> {
    return notionLib.saveCapture({
      type: capture.type,
      raw: capture.raw,
      source: capture.source,
      processed: capture.processed,
      date: capture.date,
      task: capture.taskId,
    })
  }

  async saveRecap(recap: Recap): Promise<string> {
    return notionLib.saveRecap(recap)
  }

  async getCapturesForToday(): Promise<Capture[]> {
    const today = new Date().toISOString().split('T')[0]
    return this.getCapturesForDate(today)
  }

  async getCapturesForDate(date: string): Promise<Capture[]> {
    const captures = await notionLib.getCapturesForDate(date)
    return captures.map(c => ({
      type: c.type,
      raw: c.raw,
      source: c.source,
      processed: c.processed,
      date: c.date,
      taskId: c.task,
    }))
  }
}
