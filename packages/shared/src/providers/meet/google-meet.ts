import type { MeetProvider, MeetInfo } from './types'

export class GoogleMeetProvider implements MeetProvider {
  name = 'google-meet'
  displayName = 'Google Meet'
  urlPattern = /^https:\/\/meet\.google\.com\//

  getMeetInfo(url: string): MeetInfo {
    const meetId = url.split('/').pop()?.split('?')[0]
    return {
      platform: this.name,
      meetId,
      title: `Meet ${meetId}`,
    }
  }
}
