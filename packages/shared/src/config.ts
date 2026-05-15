import * as dotenv from 'dotenv'
import path from 'path'
import os from 'os'

// ~/.brain-log/.env for global installs, fallback to cwd for local dev
dotenv.config({ path: path.join(os.homedir(), '.brain-log', '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// Getters so values are read from process.env at call time, not at import time
export const config = {
  get anthropic() {
    return { apiKey: process.env.ANTHROPIC_API_KEY || '' }
  },
  get jira() {
    return {
      host: process.env.JIRA_HOST || '',
      email: process.env.JIRA_EMAIL || '',
      token: process.env.JIRA_API_TOKEN || '',
    }
  },
  get notion() {
    return {
      token: process.env.NOTION_TOKEN || '',
      databases: {
        captures: process.env.NOTION_CAPTURES_DB || '',
        recaps: process.env.NOTION_RECAPS_DB || '',
        dailyLog: process.env.NOTION_DAILY_LOG_DB || '',
        tasks: process.env.NOTION_TASKS_DB || '',
      },
    }
  },
}

export function validateConfig() {
  const missing: string[] = []
  if (!config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY')
  if (!config.notion.token) missing.push('NOTION_TOKEN')
  if (!config.notion.databases.captures) missing.push('NOTION_CAPTURES_DB')
  if (!config.notion.databases.recaps) missing.push('NOTION_RECAPS_DB')
  if (!config.notion.databases.dailyLog) missing.push('NOTION_DAILY_LOG_DB')

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`)
  }
}
