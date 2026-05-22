import Anthropic from '@anthropic-ai/sdk'
import { config } from './config'
import type { Capture } from './providers/notes/types'

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.anthropic.apiKey })
  }
  return _client
}

const RECAP_SYSTEM_PROMPT = `Eres un asistente personal de productividad.
Tu trabajo es analizar las capturas del día de un desarrollador fullstack y generar un recap conciso y útil.
Responde SOLO en JSON con este formato exacto, sin markdown ni backticks:
{
  "whatIDid": "resumen de lo que hizo hoy (2-3 oraciones)",
  "whatILearned": "qué aprendió o descubrió hoy (1-2 oraciones)",
  "tomorrow": "sugerencias concretas para mañana basadas en el contexto (1-2 oraciones)"
}`

export async function generateRecap(captures: Capture[]): Promise<{
  whatIDid: string
  whatILearned: string
  tomorrow: string
}> {
  const client = getClient()

  const captureText = captures
    .map((c) => `[${c.type.toUpperCase()}] ${c.raw}`)
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1000,
    system: [
      {
        type: 'text',
        text: RECAP_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ] as any,
    messages: [
      {
        role: 'user',
        content: `Estas son mis capturas de hoy:\n\n${captureText}\n\nGenera el recap.`,
      },
    ],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    return JSON.parse(text)
  } catch {
    return { whatIDid: text, whatILearned: '', tomorrow: '' }
  }
}
