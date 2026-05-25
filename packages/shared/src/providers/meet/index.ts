import type { MeetProvider } from './types'
import { GoogleMeetProvider } from './google-meet'

const providers: MeetProvider[] = [
  new GoogleMeetProvider(),
  // new ZoomProvider(),
  // new TeamsProvider(),
]

export function detectMeetProvider(url: string): MeetProvider | null {
  return providers.find(p => p.urlPattern.test(url)) || null
}

export function isMeetUrl(url: string): boolean {
  return providers.some(p => p.urlPattern.test(url))
}

export type { MeetProvider, MeetInfo, TranscriptionResult, StructuredCapture } from './types'
