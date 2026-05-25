export interface MeetProvider {
  name: string
  urlPattern: RegExp
  displayName: string
  getMeetInfo(url: string): MeetInfo
}

export interface MeetInfo {
  platform: string
  meetId?: string
  title?: string
}

export interface TranscriptionResult {
  raw: string
  captures: StructuredCapture[]
  duration: number
  platform: string
  date: string
}

export interface StructuredCapture {
  type: 'note' | 'todo' | 'learn' | 'decision'
  text: string
  speaker?: string
}
