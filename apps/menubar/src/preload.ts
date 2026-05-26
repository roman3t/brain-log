import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('brain', {
  getActiveTask: () => ipcRenderer.invoke('get-active-task'),
  getBoard: () => ipcRenderer.invoke('get-board'),
  runDeployCheck: () => ipcRenderer.invoke('run-deploy-check'),
  getRecentEvents: () => ipcRenderer.invoke('get-recent-events'),
  getTaskStatus: (key: string) => ipcRenderer.invoke('get-task-status', key),
  transitionIssue: (key: string, toStatus: string) => ipcRenderer.invoke('transition-issue', key, toStatus),
  getWatchedMRs: () => ipcRenderer.invoke('get-watched-mrs'),
  getGitlabPipelines: (urls: string[]) => ipcRenderer.invoke('get-gitlab-pipelines', urls),
  clearEvents: () => ipcRenderer.invoke('clear-events'),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  onRefresh: (cb: () => void) => ipcRenderer.on('refresh', cb),
})
