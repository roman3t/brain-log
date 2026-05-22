import type { PMProvider, PMTask, PMBoard, PMTaskDetail, PMPullRequest, PMDeployment } from './types'
import {
  getJiraIssue,
  getJiraIssueDetail,
  getJiraPullRequests,
  getJiraDeployments,
  transitionJiraIssue,
  searchJiraIssues,
  getJiraCurrentUser,
  assignJiraIssue,
  getJiraTransitions,
  wasMovedBackward,
  type JiraBoardIssue,
} from '../../jira'

export class JiraProvider implements PMProvider {
  readonly name = 'jira'

  async getBoard(columns: string[]): Promise<PMBoard> {
    const issues = await searchJiraIssues(
      'project = GCD AND sprint in openSprints() AND assignee = currentUser() AND status != Done ORDER BY status ASC, priority DESC',
    )
    const counts: Record<string, number> = {}
    const grouped: Record<string, PMTask[]> = {}
    columns.forEach(c => { counts[c] = 0; grouped[c] = [] })
    for (const i of issues) {
      if (counts[i.status] !== undefined) {
        counts[i.status]++
        grouped[i.status].push(this.mapTask(i))
      }
    }
    return { columns, counts, grouped, total: issues.length }
  }

  async getMyTasks(jql: string): Promise<PMTask[]> {
    const issues = await searchJiraIssues(jql)
    return issues.map(i => this.mapTask(i))
  }

  async getTask(id: string): Promise<PMTask> {
    const issue = await getJiraIssue(id)
    return { id: issue.id, key: issue.id, title: issue.title, status: issue.status, priority: '', provider: 'jira', url: issue.url, numericId: issue.numericId }
  }

  async getTaskDetail(id: string): Promise<PMTaskDetail> {
    const detail = await getJiraIssueDetail(id)
    return {
      id: detail.id, key: detail.id, title: detail.title, status: detail.status,
      priority: detail.priority, provider: 'jira', url: detail.url, numericId: detail.numericId,
      type: detail.type, description: detail.description, comments: detail.comments,
    }
  }

  async moveTask(id: string, status: string): Promise<string> {
    return transitionJiraIssue(id, status)
  }

  async getTodoTasks(): Promise<PMTask[]> {
    const issues = await searchJiraIssues(
      'project = GCD AND sprint in openSprints() AND status = "TO DO" ORDER BY priority DESC',
    )
    return issues.map(i => this.mapTask(i))
  }

  async assignTask(id: string, userId?: string): Promise<void> {
    let uid = userId
    if (!uid) {
      const me = await getJiraCurrentUser()
      uid = me.accountId
    }
    await assignJiraIssue(id, uid)
  }

  async getCurrentUser(): Promise<{ id: string; name: string }> {
    const user = await getJiraCurrentUser()
    return { id: user.accountId, name: user.displayName }
  }

  async getTransitions(id: string): Promise<{ id: string; name: string }[]> {
    return getJiraTransitions(id)
  }

  async getPRsForTask(numericId: string): Promise<PMPullRequest[]> {
    return getJiraPullRequests(numericId)
  }

  async getDeploymentsForTask(numericId: string): Promise<PMDeployment[]> {
    return getJiraDeployments(numericId)
  }

  async wasMovedBackward(id: string, pipeline: string[]): Promise<{ backward: boolean; movedAt?: string }> {
    return wasMovedBackward(id, pipeline)
  }

  async searchTasks(jql: string): Promise<PMTask[]> {
    const issues = await searchJiraIssues(jql)
    return issues.map(i => this.mapTask(i))
  }

  private mapTask(i: JiraBoardIssue): PMTask {
    return {
      id: i.key, key: i.key, title: i.title, status: i.status,
      priority: i.priority, assignee: i.assignee, provider: 'jira',
      url: i.url, numericId: i.numericId,
    }
  }
}
