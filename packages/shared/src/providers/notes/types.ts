export type CaptureType = 'note' | 'todo' | 'vibe' | 'learn'
export type CaptureSource = 'cli' | 'browser'

export interface Capture {
  type: CaptureType
  raw: string
  source: CaptureSource
  processed?: string
  date?: string
  taskId?: string
}

export interface Recap {
  date: string
  whatIDid: string
  whatILearned: string
  tomorrow: string
}

export interface NotesProvider {
  readonly name: string
  saveCapture(capture: Capture): Promise<string>
  saveRecap(recap: Recap): Promise<string>
  getCapturesForToday(): Promise<Capture[]>
  getCapturesForDate(date: string): Promise<Capture[]>
}
