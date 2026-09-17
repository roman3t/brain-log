import fs from 'fs/promises'
import path from 'path'
import type { NotesProvider, Capture, Recap } from './types'
import { config } from '../../config'
import { getContext } from '../../state'
import { gitSync } from './git-sync'

export interface TaskPage {
  id: string
  title: string
  status: string
  priority: string
  url: string
  activatedAt: string
}

export interface ChecklistItem {
  text: string
  done: boolean
}

const ICONS: Record<string, string> = {
  note: '📝', todo: '☑️', vibe: '⚡', learn: '🧠',
}

export class MarkdownProvider implements NotesProvider {
  readonly name = 'markdown'

  private vaultPath(): string {
    if (!config.markdown.vaultPath) throw new Error('MARKDOWN_VAULT_PATH no configurado en ~/.brain-log/.env')
    return config.markdown.vaultPath
  }

  // Resolves context subfolder if VAULT_CONTEXTS is configured, falls back to root
  private contextPath(): string {
    const { contexts, defaultContext } = config.markdown
    const alias = getContext() || defaultContext
    if (!alias || Object.keys(contexts).length === 0) return this.vaultPath()
    const relative = contexts[alias]
    if (!relative) return this.vaultPath()
    return path.join(this.vaultPath(), relative)
  }

  private journalPath(date: string): string {
    const d = date.replace(/-/g, '_')
    return path.join(this.contextPath(), 'journals', `${d}.md`)
  }

  private recapPath(date: string): string {
    const d = date.replace(/-/g, '_')
    return path.join(this.contextPath(), 'recaps', `${d}.md`)
  }

  taskPath(taskId: string): string {
    return path.join(this.contextPath(), 'task-jira', `${taskId}.md`)
  }

  private taskDonePath(taskId: string): string {
    return path.join(this.contextPath(), 'task-jira', 'done', `${taskId}.md`)
  }

  // Lista los IDs de tareas que hay en el backlog (task-jira/ y task-jira/done/)
  async listTaskIds(): Promise<Array<{ id: string; archived: boolean }>> {
    const dir = path.join(this.contextPath(), 'task-jira')
    const result: Array<{ id: string; archived: boolean }> = []

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) result.push({ id: e.name.replace(/\.md$/, ''), archived: false })
      }
    } catch { return [] }

    try {
      const doneEntries = await fs.readdir(path.join(dir, 'done'))
      for (const f of doneEntries) {
        if (f.endsWith('.md')) result.push({ id: f.replace(/\.md$/, ''), archived: true })
      }
    } catch {}

    return result
  }

  // Mueve la página a task-jira/done/ si el status es terminal, o la trae de vuelta si dejó de estarlo.
  // Devuelve el path final, o null si no existía ninguna página para ese taskId.
  async archiveTaskIfDone(taskId: string, status: string, isDone: boolean): Promise<string | null> {
    const activePath = this.taskPath(taskId)
    const donePath = this.taskDonePath(taskId)

    let currentPath: string
    try {
      await fs.access(activePath)
      currentPath = activePath
    } catch {
      try {
        await fs.access(donePath)
        currentPath = donePath
      } catch {
        return null
      }
    }

    const original = await fs.readFile(currentPath, 'utf-8')
    const content = original.replace(/\*\*Status:\*\* .*/, `**Status:** ${status}`)

    const targetPath = isDone ? donePath : activePath
    if (targetPath !== currentPath) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(targetPath, content, 'utf-8')
      await fs.unlink(currentPath)
      gitSync(this.vaultPath()).catch(() => {})
      return targetPath
    }

    if (content !== original) {
      await fs.writeFile(currentPath, content, 'utf-8')
      gitSync(this.vaultPath()).catch(() => {})
    }
    return currentPath
  }

  async saveEstimate(task: TaskPage, data: { points: number; summary: string; rationale?: string }): Promise<string> {
    await this.saveTaskPage(task)  // crea la página del backlog si todavía no existe

    const filePath = this.taskPath(task.id)
    let content = await fs.readFile(filePath, 'utf-8')

    const today = new Date().toISOString().split('T')[0]
    const block = [
      '## Estimación',
      '',
      `**Puntos:** ${data.points} (Fibonacci) — ${today}`,
      '',
      data.summary,
      data.rationale ? `\n_${data.rationale}_` : '',
    ].filter(l => l !== undefined).join('\n')

    if (content.includes('## Estimación')) {
      content = content.replace(/## Estimación\n[\s\S]*?(?=\n## |\n---|$)/, `${block}\n`)
    } else if (content.includes('## Checklist')) {
      content = content.replace('## Checklist', `${block}\n\n## Checklist`)
    } else {
      content = content.endsWith('\n') ? `${content}\n${block}\n` : `${content}\n\n${block}\n`
    }

    await fs.writeFile(filePath, content, 'utf-8')
    gitSync(this.vaultPath()).catch(() => {})
    return filePath
  }

  async saveMeetSessionHeader(date: string, time: string): Promise<void> {
    const filePath = this.journalPath(date)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    let content = ''
    try { content = await fs.readFile(filePath, 'utf-8') } catch {}

    const dateHeading = `## ${date}`
    if (!content.includes(dateHeading)) {
      content = content ? `${content}\n${dateHeading}\n` : `${dateHeading}\n`
    }

    const sessionHeading = `### ${time} — Meet`
    content = content.endsWith('\n') ? `${content}${sessionHeading}\n` : `${content}\n${sessionHeading}\n`

    await fs.writeFile(filePath, content, 'utf-8')
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

  async saveTaskPage(task: TaskPage): Promise<string> {
    const filePath = this.taskPath(task.id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    try {
      await fs.access(filePath)
      return filePath  // ya existe, no sobreescribir
    } catch {}

    const urlLine = task.url ? `**URL:** ${task.url}\n` : ''
    const content = [
      `# ${task.id} — ${task.title}`,
      '',
      `**Status:** ${task.status}`,
      `**Prioridad:** ${task.priority}`,
      urlLine.trimEnd(),
      `**Activado:** ${task.activatedAt.split('T')[0]}`,
      '',
      '---',
      '',
      '## Checklist',
      '',
      '## Log',
      '',
    ].filter(l => l !== undefined).join('\n')

    await fs.writeFile(filePath, content, 'utf-8')
    gitSync(this.vaultPath()).catch(() => {})
    return filePath
  }

  async addChecklistItem(taskId: string, text: string): Promise<void> {
    const filePath = this.taskPath(taskId)
    let content = await fs.readFile(filePath, 'utf-8')
    const item = `- [ ] ${text}`
    content = content.replace(/## Checklist\n/, `## Checklist\n${item}\n`)
    await fs.writeFile(filePath, content, 'utf-8')
    gitSync(this.vaultPath()).catch(() => {})
  }

  async completeChecklistItem(taskId: string, partialText: string): Promise<boolean> {
    const filePath = this.taskPath(taskId)
    let content = await fs.readFile(filePath, 'utf-8')
    let found = false
    const updated = content.split('\n').map(line => {
      if (!found && line.startsWith('- [ ]') && line.toLowerCase().includes(partialText.toLowerCase())) {
        found = true
        return line.replace('- [ ]', '- [x]')
      }
      return line
    })
    if (found) {
      await fs.writeFile(filePath, updated.join('\n'), 'utf-8')
      gitSync(this.vaultPath()).catch(() => {})
    }
    return found
  }

  async addLogEntry(taskId: string, note: string): Promise<void> {
    const filePath = this.taskPath(taskId)
    let content = await fs.readFile(filePath, 'utf-8')
    const now = new Date()
    const timestamp = `${now.toISOString().split('T')[0]} ${now.toTimeString().slice(0, 5)}`
    const entry = `- **${timestamp}** — ${note}`
    content = content.replace(/## Log\n/, `## Log\n${entry}\n`)
    await fs.writeFile(filePath, content, 'utf-8')
    gitSync(this.vaultPath()).catch(() => {})
  }

  async getChecklist(taskId: string): Promise<ChecklistItem[]> {
    const filePath = this.taskPath(taskId)
    const content = await fs.readFile(filePath, 'utf-8')
    const items: ChecklistItem[] = []
    let inChecklist = false
    for (const line of content.split('\n')) {
      if (line === '## Checklist') { inChecklist = true; continue }
      if (line.startsWith('## ') && inChecklist) break
      if (inChecklist) {
        if (line.startsWith('- [x] ')) items.push({ text: line.slice(6), done: true })
        else if (line.startsWith('- [ ] ')) items.push({ text: line.slice(6), done: false })
      }
    }
    return items
  }
}
