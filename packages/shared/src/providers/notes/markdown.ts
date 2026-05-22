import fs from 'fs/promises'
import path from 'path'
import type { NotesProvider, Capture, Recap } from './types'
import { config } from '../../config'

const ICONS: Record<string, string> = {
  note: '📝', todo: '☑️', vibe: '⚡', learn: '🧠',
}

export class MarkdownProvider implements NotesProvider {
  readonly name = 'markdown'

  private vaultPath(): string {
    if (!config.markdown.vaultPath) throw new Error('MARKDOWN_VAULT_PATH no configurado en ~/.brain-log/.env')
    return config.markdown.vaultPath
  }

  private journalPath(date: string): string {
    const d = date.replace(/-/g, '_')
    return path.join(this.vaultPath(), 'journals', `${d}.md`)
  }

  private recapPath(date: string): string {
    const d = date.replace(/-/g, '_')
    return path.join(this.vaultPath(), 'recaps', `${d}.md`)
  }

  async saveCapture(capture: Capture): Promise<string> {
    const date = capture.date || new Date().toISOString().split('T')[0]
    const filePath = this.journalPath(date)

    await fs.mkdir(path.dirname(filePath), { recursive: true })

    let content = ''
    try { content = await fs.readFile(filePath, 'utf-8') } catch {}

    const heading = `## ${date}`
    if (!content.includes(heading)) {
      content = content ? `${content}\n${heading}\n` : `${heading}\n`
    }

    const icon = ICONS[capture.type] || '•'
    const tag = `#${capture.type}`
    const taskLink = capture.taskId ? ` [[${capture.taskId}]]` : ''
    const line = `- ${icon} ${capture.raw} ${tag}${taskLink}`

    content = content.endsWith('\n') ? `${content}${line}\n` : `${content}\n${line}\n`
    await fs.writeFile(filePath, content, 'utf-8')

    return filePath
  }

  async saveRecap(recap: Recap): Promise<string> {
    const filePath = this.recapPath(recap.date)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    const content = [
      `# Recap ${recap.date}`,
      '',
      '## Lo que hice',
      recap.whatIDid,
      '',
      '## Lo que aprendí',
      recap.whatILearned,
      '',
      '## Mañana',
      recap.tomorrow,
    ].join('\n') + '\n'

    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  async getCapturesForToday(): Promise<Capture[]> {
    const today = new Date().toISOString().split('T')[0]
    return this.getCapturesForDate(today)
  }

  async getCapturesForDate(date: string): Promise<Capture[]> {
    const filePath = this.journalPath(date)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return this.parseCaptures(content, date)
    } catch {
      return []
    }
  }

  private parseCaptures(content: string, date: string): Capture[] {
    const captures: Capture[] = []
    for (const line of content.split('\n')) {
      const match = line.match(/^- \S+ (.+?) #(note|todo|vibe|learn)/)
      if (!match) continue
      const raw = match[1].replace(/\[\[.*?\]\]/g, '').trim()
      const type = match[2] as Capture['type']
      const taskMatch = line.match(/\[\[(.+?)\]\]/)
      captures.push({ type, raw, source: 'cli', date, taskId: taskMatch?.[1] })
    }
    return captures
  }
}
