import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { saveCapture, saveMeetSessionHeader } from '@brain-log/shared'
import { config } from '@brain-log/shared'

const router = express.Router()

function getClients() {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) throw new Error('GROQ_API_KEY no configurada en .env')

  return {
    anthropic: new Anthropic({ apiKey: config.anthropic.apiKey }),
    openai: new OpenAI({
      apiKey: groqKey,
      baseURL: 'https://api.groq.com/openai/v1',
    }),
  }
}

router.post('/transcribe', async (req, res) => {
  try {
    const { audio, duration, startTime } = req.body

    if (!audio) {
      res.status(400).json({ error: 'audio is required' })
      return
    }

    const { anthropic, openai } = getClients()

    // 1. Convertir base64 a buffer y transcribir con Whisper
    const audioBuffer = Buffer.from(audio, 'base64')
    const audioFile = new File([audioBuffer], 'meet.webm', { type: 'audio/webm' })

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      response_format: 'text',
    }) as unknown as string

    // 2. Claude estructura la transcripción en captures
    const structuredResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `Eres un asistente que analiza transcripciones de reuniones de trabajo.
Extrae información relevante y estructúrala en JSON.
Responde SOLO con JSON válido, sin markdown ni backticks:
{
  "captures": [
    { "type": "note|todo|learn|decision", "text": "texto conciso" }
  ],
  "recap": {
    "summary": "resumen de 2-3 oraciones de qué se habló",
    "decisions": ["decisión 1", "decisión 2"],
    "actionItems": ["acción 1", "acción 2"]
  }
}

Reglas:
- "note": información relevante mencionada
- "todo": tarea o acción pendiente
- "learn": algo que se aprendió o descubrió
- "decision": decisión tomada en la reunión
- Sé conciso, máximo 15 palabras por capture
- Si no hay contenido relevante de un tipo, no lo incluyas`,
      messages: [{
        role: 'user',
        content: `Transcripción de la reunión (${Math.floor(duration / 60)} minutos):\n\n${transcription}`,
      }],
    })

    const rawText = structuredResponse.content[0].type === 'text'
      ? structuredResponse.content[0].text
      : '{}'

    const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const structured = JSON.parse(cleanJson)

    // 3. Escribir header de sesión con intervalo inicio - fin
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const endTime = now.toTimeString().slice(0, 5)
    const startTimeStr = startTime
      ? new Date(Number(startTime)).toTimeString().slice(0, 5)
      : endTime
    await saveMeetSessionHeader(today, `${startTimeStr} - ${endTime}`)

    let capturesCount = 0

    for (const capture of structured.captures || []) {
      await saveCapture({
        type: capture.type === 'decision' ? 'note' : capture.type,
        raw: capture.type === 'decision' ? `[DECISIÓN] ${capture.text}` : capture.text,
        source: 'browser',
        date: today,
      })
      capturesCount++
    }

    // 4. Guardar recap
    if (structured.recap) {
      const parts = [structured.recap.summary]
      if (structured.recap.decisions?.length)
        parts.push(`\nDecisiones: ${structured.recap.decisions.join(', ')}`)
      if (structured.recap.actionItems?.length)
        parts.push(`\nAction items: ${structured.recap.actionItems.join(', ')}`)

      await saveCapture({
        type: 'note',
        raw: `[MEET RECAP] ${parts.join('')}`,
        source: 'browser',
        date: today,
      })
    }

    // 5. Guardar transcripción raw (primeros 500 chars)
    await saveCapture({
      type: 'note',
      raw: `[TRANSCRIPCIÓN RAW] ${transcription}`,
      source: 'browser',
      date: today,
    })

    res.json({
      ok: true,
      capturesCount,
      recap: structured.recap,
      transcriptionLength: transcription.length,
    })

  } catch (err: any) {
    console.error('[/transcribe]', err)
    res.status(500).json({ error: err.message })
  }
})

export default router
