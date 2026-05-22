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
  get notes() {
    return {
      default: process.env.NOTES_DEFAULT || 'markdown',
    }
  },
  get markdown() {
    return {
      vaultPath: process.env.MARKDOWN_VAULT_PATH || '',
      defaultContext: process.env.VAULT_CONTEXT_DEFAULT || '',
      contexts: parseContexts(process.env.VAULT_CONTEXTS || ''),
    }
  },
  get pmDefault() {
    return process.env.PM_DEFAULT || 'jira'
  },
  get gitDefault() {
    return process.env.GIT_DEFAULT || 'gitlab'
  },
  get gitlab() {
    return {
      url: process.env.GITLAB_URL || 'https://gitlab.com',
      token: process.env.GITLAB_TOKEN || '',
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

function parseContexts(raw: string): Record<string, string> {
  if (!raw) return {}
  return Object.fromEntries(
    raw.split(',').map(pair => {
      const idx = pair.indexOf(':')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    })
  )
}

export function validateConfig() {
  const missing: string[] = []
  if (!config.notion.token) missing.push('NOTION_TOKEN')
  if (!config.notion.databases.captures) missing.push('NOTION_CAPTURES_DB')
  if (!config.notion.databases.recaps) missing.push('NOTION_RECAPS_DB')
  if (!config.notion.databases.dailyLog) missing.push('NOTION_DAILY_LOG_DB')

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`)
  }
}

export function validateTaskConfig() {
  const missing: string[] = []
  if (!config.notion.token) missing.push('NOTION_TOKEN')
  if (!config.notion.databases.tasks) missing.push('NOTION_TASKS_DB')
  if (!config.jira.host) missing.push('JIRA_HOST')
  if (!config.jira.email) missing.push('JIRA_EMAIL')
  if (!config.jira.token) missing.push('JIRA_API_TOKEN')

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`)
  }
}

export function validateAnthropicConfig() {
  if (!config.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurado — necesario para brain recap')
  }
}
