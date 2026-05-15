import express from 'express'
import cors from 'cors'
import * as dotenv from 'dotenv'
import path from 'path'
import { validateConfig, saveCapture, getCapturesForToday, generateRecap, saveRecap, getJiraIssueDetail, upsertTrackedTask } from '@brain-log/shared'
import type { CaptureType, CaptureSource } from '@brain-log/shared'

dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

const app = express()
const PORT = process.env.PORT || 3141

app.use(cors())
app.use(express.json())

// ── Auth middleware ─────────────────────────────────────────────
const API_SECRET = process.env.API_SECRET || 'brain-log-secret'

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers['x-api-key'] || req.query.key
  if (token !== API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// ── Health check ────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── POST /capture ───────────────────────────────────────────────
// Body: { type, raw, source? }
app.post('/capture', auth, async (req, res) => {
  try {
    validateConfig()

    const { type, raw, source = 'browser' } = req.body

    const validTypes: CaptureType[] = ['note', 'todo', 'vibe', 'learn']
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
      return
    }

    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      res.status(400).json({ error: 'raw is required' })
      return
    }

    const id = await saveCapture({
      type,
      raw: raw.trim(),
      source: source as CaptureSource,
    })

    res.json({ ok: true, id })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /today ──────────────────────────────────────────────────
app.get('/today', auth, async (_req, res) => {
  try {
    validateConfig()
    const captures = await getCapturesForToday()
    res.json({ captures, count: captures.length })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ── POST /recap ─────────────────────────────────────────────────
app.post('/recap', auth, async (_req, res) => {
  try {
    validateConfig()

    const captures = await getCapturesForToday()
    if (captures.length === 0) {
      res.status(400).json({ error: 'No captures today' })
      return
    }

    const recap = await generateRecap(captures)
    const today = new Date().toISOString().split('T')[0]
    const id = await saveRecap({ date: today, ...recap })

    res.json({ ok: true, id, recap })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ── POST /task ──────────────────────────────────────────────────
// Body: { issueKey }
app.post('/task', auth, async (req, res) => {
  try {
    validateConfig()
    const { issueKey } = req.body
    if (!issueKey || typeof issueKey !== 'string') {
      res.status(400).json({ error: 'issueKey is required' })
      return
    }
    const issue = await getJiraIssueDetail(issueKey.toUpperCase())
    await upsertTrackedTask(issue)
    res.json({ ok: true, issue })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  console.log(`🧠 brain-log API running on http://localhost:${PORT}`)
  console.log(`   Secret: ${API_SECRET}`)
})
