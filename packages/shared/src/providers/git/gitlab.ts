import type { GitProvider, GitMRStatus, GitPipeline } from './types'

export class GitLabProvider implements GitProvider {
  readonly name = 'gitlab'

  private get baseUrl() { return process.env.GITLAB_URL || 'https://gitlab.com' }
  private get token() { return process.env.GITLAB_TOKEN || '' }
  private headers() { return { 'PRIVATE-TOKEN': this.token } }

  private parse(url: string): { projectPath: string; mrIid: string } | null {
    const mrMatch = url.match(/\/merge_requests\/(\d+)/)
    const projMatch = url.match(/gitlab[^/]+\/(.+?)\/-\/merge_requests/)
    if (!mrMatch || !projMatch) return null
    return { projectPath: projMatch[1], mrIid: mrMatch[1] }
  }

  async getMRStatus(url: string): Promise<GitMRStatus> {
    const parsed = this.parse(url)
    if (!parsed) throw new Error(`URL de GitLab inválida: ${url}`)

    const { projectPath, mrIid } = parsed
    const encodedPath = encodeURIComponent(projectPath)

    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`,
      { headers: this.headers() },
    )
    if (!res.ok) throw new Error(`GitLab ${res.status}: ${await res.text()}`)
    const mr = await res.json() as any

    let pipeline = mr.head_pipeline
    let pipelineContext = 'MR'

    if (mr.state === 'merged') {
      const sha = mr.merge_commit_sha || mr.squash_commit_sha
      if (sha) {
        const postMerge = await this.getPostMergePipeline(encodedPath, sha)
        if (postMerge) { pipeline = postMerge; pipelineContext = mr.target_branch }
      }
    }

    return {
      mrIid,
      mrState: mr.state || '',
      targetBranch: mr.target_branch || '',
      sourceBranch: mr.source_branch || '',
      title: mr.title || '',
      pipelineStatus: pipeline?.status ?? null,
      pipelineUrl: pipeline?.web_url ?? null,
      pipelineContext,
      mergeSha: mr.merge_commit_sha || mr.squash_commit_sha,
      url,
    }
  }

  async getPostMergePipeline(projectPath: string, sha: string): Promise<GitPipeline | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v4/projects/${projectPath}/pipelines?sha=${sha}&per_page=1`,
        { headers: this.headers() },
      )
      if (!res.ok) return null
      const pipes = await res.json() as any[]
      if (!pipes.length) return null
      return { id: String(pipes[0].id), status: pipes[0].status, url: pipes[0].web_url, ref: pipes[0].ref, sha: pipes[0].sha }
    } catch {
      return null
    }
  }

  async getMRStatusBatch(urls: string[]): Promise<GitMRStatus[]> {
    const results: GitMRStatus[] = []
    for (const url of urls) {
      try { results.push(await this.getMRStatus(url)) } catch {}
    }
    return results
  }
}
