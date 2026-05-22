export interface PMTask {
  id: string
  key: string
  title: string
  status: string
  priority: string
  assignee?: string
  provider: string
  url: string
  numericId?: string
}

export interface PMTaskDetail extends PMTask {
  type: string
  description: string
  comments: { author: string; body: string; created: string }[]
}

export interface PMBoard {
  columns: string[]
  counts: Record<string, number>
  grouped: Record<string, PMTask[]>
  total: number
}

export interface PMPullRequest {
  title: string
  status: string
  sourceBranch: string
  targetBranch: string
  url: string
  lastUpdated: string
}

export interface PMDeployment {
  environment: string
  state: string
  displayName: string
  lastUpdated: string
}

export interface PMProvider {
  readonly name: string
  getBoard(columns: string[]): Promise<PMBoard>
  getMyTasks(query: string): Promise<PMTask[]>
  getTask(id: string): Promise<PMTask>
  getTaskDetail(id: string): Promise<PMTaskDetail>
  moveTask(id: string, status: string): Promise<string>
  getTodoTasks(): Promise<PMTask[]>
  assignTask(id: string, userId?: string): Promise<void>
  getCurrentUser(): Promise<{ id: string; name: string }>
  getTransitions(id: string): Promise<{ id: string; name: string }[]>
  getPRsForTask(numericId: string): Promise<PMPullRequest[]>
  getDeploymentsForTask(numericId: string): Promise<PMDeployment[]>
  wasMovedBackward(id: string, pipeline: string[]): Promise<{ backward: boolean; movedAt?: string }>
  searchTasks(jql: string): Promise<PMTask[]>
}
