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

export const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13, 21] as const
export type FibonacciPoints = typeof FIBONACCI_POINTS[number]

const STORY_SUMMARY_SYSTEM_PROMPT = `Eres un asistente que ayuda a un equipo de desarrollo a preparar planning poker.
Dado el título, descripción y comentarios de un ticket de Jira, evalúa su complejidad y responde SOLO en JSON,
sin markdown ni backticks, con este formato exacto:
{
  "summary": "resumen de 2-3 oraciones: qué hay que hacer, qué partes del sistema toca, y riesgos/incertidumbre mencionados en los comentarios",
  "suggestedPoints": <uno de estos valores exactos: 1, 2, 3, 5, 8, 13, 21 (escala Fibonacci)>,
  "rationale": "1 oración explicando por qué ese puntaje (alcance, incertidumbre, dependencias)"
}
Usa 1-2 para cambios triviales y bien definidos, 3-5 para trabajo estándar de una feature acotada,
8 para trabajo con varias partes o incertidumbre moderada, 13-21 para historias que probablemente deberían dividirse.`

export interface StoryEstimate {
  summary: string
  suggestedPoints: FibonacciPoints
  rationale: string
}

export async function summarizeStoryForEstimate(input: {
  title: string
  description: string
  comments: string[]
}): Promise<StoryEstimate> {
  const client = getClient()

  const text = [
    `Título: ${input.title}`,
    input.description ? `Descripción:\n${input.description}` : '',
    input.comments.length ? `Comentarios:\n${input.comments.join('\n---\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: STORY_SUMMARY_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ] as any,
    messages: [{ role: 'user', content: text }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(jsonText)
    const points = FIBONACCI_POINTS.includes(parsed.suggestedPoints) ? parsed.suggestedPoints : 5
    return { summary: parsed.summary || '', suggestedPoints: points, rationale: parsed.rationale || '' }
  } catch {
    return { summary: raw.trim(), suggestedPoints: 5, rationale: '' }
  }
}
