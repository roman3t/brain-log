import { app, BrowserWindow, Tray, nativeImage, ipcMain, shell, screen } from 'electron'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { execSync, exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(os.homedir(), '.brain-log', '.env') })

import { searchJiraIssues, getActiveTask, getActiveTasks, wasMovedBackward, transitionJiraIssue, getJiraIssue, getJiraPullRequests, getJiraDeployments, getWatchedMRs } from '@brain-log/shared'

let tray: Tray | null = null
let win: BrowserWindow | null = null

const COLUMNS = ['TO DO', 'DOING', 'TESTING DEV', 'TESTING QA', 'TESTING PROD', 'DEPLOY TO PROD', 'HOLD']
const BRAIN_BIN = '/opt/homebrew/bin/brain'
const LOG_PATH = path.join(os.homedir(), '.brain-log', 'deploy-watch.log')

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.loadFile(path.join(__dirname, 'ui', 'index.html'))

  win.on('blur', () => {
    if (!win!.webContents.isDevToolsOpened()) win!.hide()
  })
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setTitle('🧠')
  tray.setToolTip('brain-log')

  tray.on('click', (_, bounds) => {
    if (!win) return
    if (win.isVisible()) {
      win.hide()
      return
    }

    const { width } = win.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
    const { x: workX, width: workWidth } = display.workArea
    const x = Math.max(workX, Math.min(Math.round(bounds.x - width / 2), workX + workWidth - width))
    const y = Math.round(bounds.y + bounds.height + 4)

    win.setPosition(x, y)
    win.show()
    win.focus()
    win.webContents.send('refresh')
  })
}

// ── IPC Handlers ────────────────────────────────────────────────

ipcMain.handle('get-active-task', () => {
  try { return getActiveTask() } catch { return null }
})

ipcMain.handle('get-active-tasks', () => {
  try { return getActiveTasks() } catch { return [] }
})

ipcMain.handle('get-watched-mrs', () => {
  try { return getWatchedMRs() } catch { return [] }
})

ipcMain.handle('get-task-status', async (_, issueKey: string) => {
  try {
    const issue = await getJiraIssue(issueKey)
    const [prs, deployments] = await Promise.all([
      getJiraPullRequests(issue.numericId).catch(() => []),
      getJiraDeployments(issue.numericId).catch(() => []),
    ])
    return { status: issue.status, prs, deployments }
  } catch { return null }
})

ipcMain.handle('get-board', async () => {
  try {
    const issues = await searchJiraIssues(
      'project = GCD AND sprint in openSprints() AND assignee = currentUser() AND status != Done ORDER BY status ASC, priority DESC',
    )
    const counts: Record<string, number> = {}
    const grouped: Record<string, typeof issues> = {}
    COLUMNS.forEach(c => { counts[c] = 0; grouped[c] = [] })

    for (const i of issues) {
      if (counts[i.status] !== undefined) {
        counts[i.status]++
        grouped[i.status].push(i)
      }
    }

    return { counts, grouped, columns: COLUMNS, total: issues.length }
  } catch (e: any) {
    return { error: e.message }
  }
})

ipcMain.handle('run-deploy-check', async () => {
  try {
    const { stdout } = await execAsync(`${BRAIN_BIN} deploy-check`, {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
      timeout: 60000,
    })
    return { ok: true, output: stdout.trim() }
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message }
  }
})

ipcMain.handle('get-recent-events', () => {
  try {
    if (!fs.existsSync(LOG_PATH)) return []
    const lines = fs.readFileSync(LOG_PATH, 'utf-8')
      .split('\n')
      .filter(l => l.trim() && !l.includes('No such file'))
    return lines.slice(-15).reverse()
  } catch {
    return []
  }
})

ipcMain.handle('transition-issue', async (_, issueKey: string, toStatus: string) => {
  try {
    await transitionJiraIssue(issueKey, toStatus)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-gitlab-pipelines', async (_, prUrls: string[]) => {
  const gitlabUrl = process.env.GITLAB_URL || ''
  const gitlabToken = process.env.GITLAB_TOKEN || ''
  if (!gitlabUrl || !gitlabToken) return []

  const results: any[] = []
  for (const url of prUrls) {
    const mrIidMatch = url.match(/\/merge_requests\/(\d+)/)
    const projectMatch = url.match(/gitlab[^/]+\/(.+?)\/-\/merge_requests/)
    if (!mrIidMatch || !projectMatch) continue

    const mrIid = mrIidMatch[1]
    const projectPath = encodeURIComponent(projectMatch[1])

    try {
      const mrRes = await fetch(`${gitlabUrl}/api/v4/projects/${projectPath}/merge_requests/${mrIid}`, {
        headers: { 'PRIVATE-TOKEN': gitlabToken },
      })
      if (!mrRes.ok) continue
      const mr = await mrRes.json() as any

      let pipeline = mr.head_pipeline
      let pipelineContext = 'MR'

      if (mr.state === 'merged') {
        const sha = mr.merge_commit_sha || mr.squash_commit_sha
        if (sha) {
          const pRes = await fetch(
            `${gitlabUrl}/api/v4/projects/${projectPath}/pipelines?sha=${sha}&per_page=1`,
            { headers: { 'PRIVATE-TOKEN': gitlabToken } },
          )
          if (pRes.ok) {
            const pipes = await pRes.json() as any[]
            if (pipes.length > 0) { pipeline = pipes[0]; pipelineContext = mr.target_branch }
          }
        }
      }

      results.push({
        url,
        mrIid,
        mrState: mr.state,
        targetBranch: mr.target_branch,
        pipelineStatus: pipeline?.status ?? null,
        pipelineUrl: pipeline?.web_url ?? null,
        pipelineContext,
      })
    } catch {}
  }

  return results
})

ipcMain.handle('clear-events', () => {
  try {
    if (fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '', 'utf-8')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('open-url', (_, url: string) => shell.openExternal(url))

// ── App lifecycle ────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.dock) app.dock.hide()
  createTray()
  createWindow()
})

app.on('window-all-closed', () => { /* keep app running in tray */ })
