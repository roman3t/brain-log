import fs from 'fs'
import path from 'path'
import os from 'os'

const STATE_PATH = path.join(os.homedir(), '.brain-log', 'state.json')

export interface ActiveTask {
  id: string
  title: string
  url: string
  setAt: string
}

interface State {
  activeTask?: ActiveTask
  pinnedTasks?: string[]
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

export function getActiveTask(): ActiveTask | undefined {
  return read().activeTask
}

export function setActiveTask(task: ActiveTask): void {
  write({ ...read(), activeTask: task })
}

export function clearActiveTask(): void {
  const state = read()
  delete state.activeTask
  write(state)
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
