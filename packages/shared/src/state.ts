import fs from 'fs'
import path from 'path'
import os from 'os'

const STATE_PATH = path.join(os.homedir(), '.brain-log', 'state.json')

export interface ActiveTask {
  id: string
  title: string
  url: string
  setAt: string
  provider?: string
}

interface State {
  context?: string
  activeTask?: ActiveTask       // legacy — kept for backward compat
  activeTasks?: ActiveTask[]    // new multi-task format
  pinnedTasks?: string[]
  watchedMRs?: string[]
}

function read(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function write(state: State): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

// ── Multi-task API ───────────────────────────────────────────────

export function getActiveTasks(): ActiveTask[] {
  const state = read()
  // Migrate legacy single-task format transparently
  if (state.activeTasks) return state.activeTasks
  if (state.activeTask) return [state.activeTask]
  return []
}

export function addActiveTask(task: ActiveTask): void {
  const state = read()
  const tasks = getActiveTasks().filter(t => t.id !== task.id)
  tasks.unshift(task)
  write({ ...state, activeTasks: tasks, activeTask: task })
}

export function removeActiveTask(id: string): void {
  const state = read()
  const tasks = getActiveTasks().filter(t => t.id !== id)
  const next = tasks[0]
  write({ ...state, activeTasks: tasks, activeTask: next })
}

export function clearAllActiveTasks(): void {
  const state = read()
  write({ ...state, activeTasks: [], activeTask: undefined })
}

// ── Legacy single-task API (backward compat) ─────────────────────

export function getActiveTask(): ActiveTask | undefined {
  return getActiveTasks()[0]
}

export function setActiveTask(task: ActiveTask): void {
  addActiveTask(task)
}

export function clearActiveTask(): void {
  const tasks = getActiveTasks()
  if (tasks.length > 0) removeActiveTask(tasks[0].id)
}

export function pinTask(issueKey: string): void {
  const state = read()
  const pinned = new Set(state.pinnedTasks || [])
  pinned.add(issueKey.toUpperCase())
  write({ ...state, pinnedTasks: [...pinned] })
}

export function unpinTask(issueKey: string): void {
  const state = read()
  const pinned = new Set(state.pinnedTasks || [])
  pinned.delete(issueKey.toUpperCase())
  write({ ...state, pinnedTasks: [...pinned] })
}

export function getPinnedTasks(): string[] {
  return read().pinnedTasks || []
}

export function addWatchedMR(url: string): void {
  const state = read()
  const watched = new Set(state.watchedMRs || [])
  watched.add(url)
  write({ ...state, watchedMRs: [...watched] })
}

export function removeWatchedMR(url: string): void {
  const state = read()
  const watched = new Set(state.watchedMRs || [])
  watched.delete(url)
  write({ ...state, watchedMRs: [...watched] })
}

export function getWatchedMRs(): string[] {
  return read().watchedMRs || []
}

// ── Context API ──────────────────────────────────────────────────

export function getContext(): string {
  return read().context || ''
}

export function setContext(alias: string): void {
  const state = read()
  write({ ...state, context: alias })
}
