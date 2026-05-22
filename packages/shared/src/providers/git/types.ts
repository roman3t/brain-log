export interface GitMRStatus {
  mrIid: string
  mrState: string
  targetBranch: string
  sourceBranch: string
  title: string
  pipelineStatus: string | null
  pipelineUrl: string | null
  pipelineContext: string
  mergeSha?: string
  url: string
}

export interface GitPipeline {
  id: string
  status: string
  url: string
  ref: string
  sha: string
}

export interface GitProvider {
  readonly name: string
  getMRStatus(url: string): Promise<GitMRStatus>
  getPostMergePipeline(projectPath: string, sha: string): Promise<GitPipeline | null>
  getMRStatusBatch(urls: string[]): Promise<GitMRStatus[]>
}
