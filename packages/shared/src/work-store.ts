import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

export interface WorkSession {
  id: string
  taskId: string
  title: string
  url: string
  repoPath: string
  commonDir: string
  worktreePath: string
  branch: string
  base: string
  context: string
  contextFile: string
  createdAt: string
  closedAt?: string
  herdr?: { session: string; socketPath?: string; workspaceId: string; paneId: string }
  repoAlias?: string
}

export function workStoreDir(): string {
  return path.join(os.homedir(), '.brain-log')
}

export function readWorkSessions(): WorkSession[] {
  const file = path.join(workStoreDir(), 'workspaces.json')
  let raw: string
  try { raw = fs.readFileSync(file, 'utf8') } catch (error: any) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const data = JSON.parse(raw)
  if (data.version !== 1 || !Array.isArray(data.sessions)) {
    throw new Error(`Registro de worktrees inválido: ${file}. No se ha modificado.`)
  }
  for (const session of data.sessions) {
    if (!session || !['id', 'taskId', 'title', 'url', 'repoPath', 'commonDir', 'worktreePath', 'branch', 'base', 'context', 'contextFile', 'createdAt']
      .every(key => typeof session[key] === 'string') ||
        !['repoPath', 'commonDir', 'worktreePath', 'contextFile'].every(key => path.isAbsolute(session[key])) ||
        (session.herdr && !['session', 'workspaceId', 'paneId'].every(key => typeof session.herdr[key] === 'string'))) {
      throw new Error(`Registro de worktrees inválido: ${file}. No se ha modificado.`)
    }
  }
  return data.sessions
}

export function writeWorkSessions(sessions: WorkSession[]): void {
  fs.mkdirSync(workStoreDir(), { recursive: true })
  const file = path.join(workStoreDir(), 'workspaces.json')
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions }, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

// Serialize the whole lifecycle, including Git and Herdr, across CLI processes.
export function withWorkLock<T>(action: () => T): T {
  fs.mkdirSync(workStoreDir(), { recursive: true })
  const lock = path.join(workStoreDir(), 'workspaces.lock')
  let fd: number
  try { fd = fs.openSync(lock, 'wx', 0o600) } catch (error: any) {
    if (error.code !== 'EEXIST') throw error
    throw new Error(`Otra operación de worktrees está en curso (${lock}). Si hubo una interrupción, verifica que terminó antes de retirar el lock.`)
  }
  try {
    fs.writeFileSync(fd, String(process.pid))
    return action()
  } finally {
    fs.closeSync(fd)
    fs.unlinkSync(lock)
  }
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function getWorkSessionsForTask(taskId: string): WorkSession[] {
  return readWorkSessions().filter(s => s.taskId === taskId.toUpperCase())
}

export function getWorkSession(cwd = process.cwd()): WorkSession | undefined {
  let resolved: string
  try { resolved = fs.realpathSync(cwd) } catch { return undefined }
  // Longest path wins if a user has nested repositories.
  return readWorkSessions().filter(s => !s.closedAt && isWithin(s.worktreePath, resolved))
    .sort((a, b) => b.worktreePath.length - a.worktreePath.length)[0]
}

export function normalizeWorkTask(task: string): string {
  const id = task.toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(id)) {
    throw new Error('Usa un ID de tarea como GCD-1134 o VAN-01.')
  }
  return id
}
