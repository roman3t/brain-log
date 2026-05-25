# brain-log — Voice & Meet Transcription

## Contexto

Feature de transcripción de reuniones integrado en la extensión Chrome existente.
Usa tabCapture API para grabar el audio del tab de Google Meet, Whisper para
transcribir, y Claude para estructurar el contenido en captures del vault.

El diseño sigue el mismo Provider Pattern del resto del proyecto — no está
casado con Google Meet, cualquier plataforma puede agregarse como provider.

---

## Arquitectura

```
packages/extension/
  popup.html/js         → agrega tab "Meet" dinámico
  background.js         → maneja tabCapture + MediaRecorder
  content.js            → detecta plataforma por URL

packages/shared/src/
  providers/
    meet/
      types.ts          → interfaz MeetProvider
      google-meet.ts    → implementa MeetProvider para meet.google.com
      zoom.ts           → futuro: zoom.us
      teams.ts          → futuro: teams.microsoft.com
      index.ts          → factory: detecta provider por URL

apps/api/src/
  routes/transcribe.ts  → POST /transcribe → Whisper → Claude → vault
```

---

## Meet Provider Interface

```typescript
// providers/meet/types.ts

export interface MeetProvider {
  name: string
  urlPattern: RegExp        // para detectar si el tab es un meet
  displayName: string       // "Google Meet", "Zoom", "Teams"

  // Extrae metadata del meet desde la URL o el DOM
  getMeetInfo(url: string): MeetInfo
}

export interface MeetInfo {
  platform: string          // 'google-meet' | 'zoom' | 'teams'
  meetId?: string           // ID de la reunión si está en la URL
  title?: string            // título si está disponible
}

export interface TranscriptionResult {
  raw: string               // transcripción literal de Whisper
  captures: StructuredCapture[]  // lo que Claude extrajo
  duration: number          // duración en segundos
  platform: string
  date: string
}

export interface StructuredCapture {
  type: 'note' | 'todo' | 'learn' | 'decision'
  text: string
  speaker?: string          // futuro: con diarización
}
```

---

## Google Meet Provider

```typescript
// providers/meet/google-meet.ts

import { MeetProvider, MeetInfo } from './types'

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
```

---

## Factory — detección automática por URL

```typescript
// providers/meet/index.ts

import { MeetProvider } from './types'
import { GoogleMeetProvider } from './google-meet'

const providers: MeetProvider[] = [
  new GoogleMeetProvider(),
  // new ZoomProvider(),    // futuro
  // new TeamsProvider(),   // futuro
]

export function detectMeetProvider(url: string): MeetProvider | null {
  return providers.find(p => p.urlPattern.test(url)) || null
}

export function isMeetUrl(url: string): boolean {
  return providers.some(p => p.urlPattern.test(url))
}
```

---

## Extensión Chrome — cambios en popup.html

### Tab "Meet" dinámico

El tab Meet aparece solo cuando el tab activo es un meet.
Agregar al HTML existente:

```html
<!-- En la sección de tabs, después de "Capturar" -->
<button class="tab" id="tab-meet-btn" data-tab="meet" style="display:none">
  🎙 Meet
</button>

<!-- Tab content Meet -->
<div id="tab-meet" class="body" style="display:none">

  <!-- Estado: sin meet detectado -->
  <div id="meet-idle">
    <p style="color:#666;font-size:13px;text-align:center;padding:20px 0">
      Abre Google Meet para grabar
    </p>
  </div>

  <!-- Estado: meet detectado, listo para grabar -->
  <div id="meet-ready" style="display:none">
    <div style="background:#1a1a1a;border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;color:#666;margin-bottom:4px">Meet detectado</div>
      <div id="meet-platform" style="font-size:13px;color:#e8e8e8"></div>
    </div>
    <button class="btn" id="start-recording-btn">
      🔴 Iniciar grabación
    </button>
  </div>

  <!-- Estado: grabando -->
  <div id="meet-recording" style="display:none">
    <div style="
      background:#1a0000;
      border:1px solid #450000;
      border-radius:8px;
      padding:12px;
      margin-bottom:12px;
      text-align:center
    ">
      <div style="color:#f87171;font-size:13px;font-weight:600">
        🔴 Grabando
      </div>
      <div id="recording-timer" style="
        font-size:28px;
        font-weight:700;
        color:#e8e8e8;
        margin:8px 0;
        font-variant-numeric:tabular-nums
      ">00:00</div>
    </div>
    <button class="btn" id="stop-recording-btn" style="background:#f87171;color:#0f0f0f">
      ⏹ Terminar y transcribir
    </button>
  </div>

  <!-- Estado: procesando -->
  <div id="meet-processing" style="display:none">
    <div style="text-align:center;padding:20px 0;color:#a78bfa">
      <div style="font-size:24px;margin-bottom:8px">⚡</div>
      <div id="processing-status" style="font-size:13px">Transcribiendo...</div>
    </div>
  </div>

  <!-- Toast de resultado -->
  <div class="toast" id="meet-toast"></div>
</div>
```

---

## Extensión Chrome — popup.js (sección Meet)

```javascript
// Agregar al popup.js existente

// ── Detección de meet en tab activo ────────────────────────────
const MEET_PATTERNS = [
  { pattern: /meet\.google\.com/, name: 'Google Meet' },
  // { pattern: /zoom\.us\/j\//, name: 'Zoom' },         // futuro
  // { pattern: /teams\.microsoft\.com/, name: 'Teams' }, // futuro
]

function detectMeet(url) {
  return MEET_PATTERNS.find(p => p.pattern.test(url)) || null
}

// Verificar si el tab activo es un meet al abrir el popup
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url || ''
  const meet = detectMeet(url)

  if (meet) {
    // Mostrar tab Meet
    document.getElementById('tab-meet-btn').style.display = 'block'
    document.getElementById('meet-platform').textContent = meet.name
    document.getElementById('meet-idle').style.display = 'none'
    document.getElementById('meet-ready').style.display = 'block'
  }
})

// ── Estado de grabación ─────────────────────────────────────────
let recordingStartTime = null
let timerInterval = null

function updateTimer() {
  if (!recordingStartTime) return
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000)
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const secs = String(elapsed % 60).padStart(2, '0')
  document.getElementById('recording-timer').textContent = `${mins}:${secs}`
}

// Sincronizar estado con background al abrir popup
chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, state => {
  if (state?.isRecording) {
    showRecordingUI()
    recordingStartTime = state.startTime
    timerInterval = setInterval(updateTimer, 1000)
  }
})

// ── Iniciar grabación ───────────────────────────────────────────
document.getElementById('start-recording-btn').addEventListener('click', async () => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      tabId: tabs[0].id,
      url: tabs[0].url,
    }, response => {
      if (response?.ok) {
        showRecordingUI()
        recordingStartTime = Date.now()
        timerInterval = setInterval(updateTimer, 1000)
        // Punto del header se pone rojo
        document.getElementById('status').style.background = '#f87171'
      } else {
        showMeetToast('Error al iniciar grabación', 'error')
      }
    })
  })
})

// ── Detener y transcribir ───────────────────────────────────────
document.getElementById('stop-recording-btn').addEventListener('click', () => {
  clearInterval(timerInterval)
  showProcessingUI('Deteniendo grabación...')

  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, async response => {
    if (!response?.audioBlob) {
      showProcessingUI('Procesando audio...')
    }
    // El background.js envía el audio a la API y notifica cuando termina
  })
})

// ── Escuchar resultado del background ──────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TRANSCRIPTION_DONE') {
    const { capturesCount } = msg
    document.getElementById('meet-processing').style.display = 'none'
    document.getElementById('meet-ready').style.display = 'block'
    document.getElementById('status').style.background = '#4ade80'
    showMeetToast(`✓ ${capturesCount} captures guardados en el vault`, 'success')
  }

  if (msg.type === 'TRANSCRIPTION_ERROR') {
    document.getElementById('meet-processing').style.display = 'none'
    document.getElementById('meet-ready').style.display = 'block'
    showMeetToast(msg.error, 'error')
  }

  if (msg.type === 'PROCESSING_STATUS') {
    document.getElementById('processing-status').textContent = msg.status
  }
})

// ── UI helpers ──────────────────────────────────────────────────
function showRecordingUI() {
  document.getElementById('meet-ready').style.display = 'none'
  document.getElementById('meet-recording').style.display = 'block'
}

function showProcessingUI(status) {
  document.getElementById('meet-recording').style.display = 'none'
  document.getElementById('meet-processing').style.display = 'block'
  document.getElementById('processing-status').textContent = status
}

function showMeetToast(msg, type) {
  const el = document.getElementById('meet-toast')
  el.textContent = msg
  el.className = `toast ${type}`
  setTimeout(() => { el.className = 'toast' }, 4000)
}
```

---

## background.js — tabCapture + MediaRecorder

```javascript
// Agregar al background.js existente

let mediaRecorder = null
let audioChunks = []
let recordingState = {
  isRecording: false,
  startTime: null,
  tabId: null,
  url: null,
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── GET_RECORDING_STATE ───────────────────────────────────────
  if (msg.type === 'GET_RECORDING_STATE') {
    sendResponse(recordingState)
    return true
  }

  // ── START_RECORDING ───────────────────────────────────────────
  if (msg.type === 'START_RECORDING') {
    chrome.tabCapture.capture(
      { audio: true, video: false },
      stream => {
        if (!stream) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message })
          return
        }

        audioChunks = []
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) audioChunks.push(e.data)
        }

        mediaRecorder.start(1000) // chunk cada segundo

        recordingState = {
          isRecording: true,
          startTime: Date.now(),
          tabId: msg.tabId,
          url: msg.url,
        }

        sendResponse({ ok: true })
      }
    )
    return true // async
  }

  // ── STOP_RECORDING ────────────────────────────────────────────
  if (msg.type === 'STOP_RECORDING') {
    if (!mediaRecorder) {
      sendResponse({ ok: false })
      return true
    }

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
      const duration = Math.floor((Date.now() - recordingState.startTime) / 1000)

      recordingState.isRecording = false

      // Notificar que está procesando
      chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Transcribiendo...' })

      await sendToAPI(audioBlob, duration, recordingState.url)
    }

    mediaRecorder.stop()
    mediaRecorder.stream.getTracks().forEach(t => t.stop())
    sendResponse({ ok: true })
    return true
  }
})

// ── Enviar audio a la API ────────────────────────────────────────
async function sendToAPI(audioBlob, duration, meetUrl) {
  try {
    const { apiUrl, apiSecret } = await chrome.storage.sync.get(['apiUrl', 'apiSecret'])
    if (!apiUrl) throw new Error('API URL no configurada')

    // Convertir blob a base64
    const arrayBuffer = await audioBlob.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

    chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Enviando a la API...' })

    const res = await fetch(`${apiUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret || 'brain-log-secret',
      },
      body: JSON.stringify({
        audio: base64,
        duration,
        meetUrl,
        source: 'browser',
      }),
    })

    const data = await res.json()

    if (res.ok) {
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_DONE',
        capturesCount: data.capturesCount,
        recap: data.recap,
      })
    } else {
      throw new Error(data.error || 'Error en transcripción')
    }
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_ERROR',
      error: err.message,
    })
  }
}
```

---

## API — POST /transcribe

```typescript
// apps/api/src/routes/transcribe.ts

import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { saveCapture, saveRecap } from '@brain-log/shared'
import { config } from '@brain-log/shared'

const router = express.Router()
const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey })

// Whisper via OpenAI SDK
import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: config.openai.apiKey })

router.post('/transcribe', async (req, res) => {
  try {
    const { audio, duration, meetUrl, source } = req.body

    // 1. Convertir base64 a buffer
    const audioBuffer = Buffer.from(audio, 'base64')
    const audioFile = new File([audioBuffer], 'meet.webm', { type: 'audio/webm' })

    // 2. Transcribir con Whisper
    // Notificar progreso no es posible via HTTP sync,
    // pero el cliente ya muestra "Transcribiendo..."
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'es',        // español por default, Whisper auto-detecta si se omite
      response_format: 'text',
    })

    // 3. Claude estructura la transcripción en captures
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

    const structured = JSON.parse(
      structuredResponse.content[0].type === 'text'
        ? structuredResponse.content[0].text
        : '{}'
    )

    // 4. Guardar captures en el vault
    const today = new Date().toISOString().split('T')[0]
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

    // 5. Guardar recap de la reunión
    if (structured.recap) {
      const meetRecap = [
        structured.recap.summary,
        structured.recap.decisions?.length
          ? `\nDecisiones: ${structured.recap.decisions.join(', ')}`
          : '',
        structured.recap.actionItems?.length
          ? `\nAction items: ${structured.recap.actionItems.join(', ')}`
          : '',
      ].join('')

      await saveCapture({
        type: 'note',
        raw: `[MEET RECAP] ${meetRecap}`,
        source: 'browser',
        date: today,
      })
    }

    // 6. Guardar transcripción raw en el vault (para referencia)
    await saveCapture({
      type: 'note',
      raw: `[TRANSCRIPCIÓN RAW] ${transcription.slice(0, 500)}${transcription.length > 500 ? '...' : ''}`,
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
```

---

## Variables de entorno nuevas

```env
# OpenAI — solo para Whisper
OPENAI_API_KEY=sk-...

# Whisper config (opcional)
WHISPER_LANGUAGE=es    # forzar español, omitir para auto-detect
```

---

## Costo estimado

| Duración meet | Costo Whisper | Costo Claude Haiku | Total |
|--------------|--------------|-------------------|-------|
| 15 min daily | ~$0.09 | ~$0.002 | ~$0.09 |
| 30 min       | ~$0.18 | ~$0.003 | ~$0.18 |
| 1 hora       | ~$0.36 | ~$0.005 | ~$0.37 |

Un mes de dailies de 15 min = ~$2.00

---

## Permisos nuevos en manifest.json

```json
{
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus",
    "tabCapture"
  ]
}
```

---

## Flujo completo del usuario

```
1. Abres Google Meet
2. Click en ícono brain-log → tab "Meet" aparece automáticamente
3. Click "🔴 Iniciar grabación"
4. Haces tu daily standup normalmente
5. Click "⏹ Terminar y transcribir"
6. El punto del header pulsa mientras procesa
7. "✓ 8 captures guardados en el vault"
8. Abres Obsidian/Logseq → ves las notas estructuradas del meet
```

---

## Orden de implementación

1. Agregar `tabCapture` a `manifest.json`
2. Crear `providers/meet/types.ts`
3. Crear `providers/meet/google-meet.ts`
4. Crear `providers/meet/index.ts` con factory
5. Actualizar `background.js` con lógica de grabación
6. Actualizar `popup.html` con tab Meet dinámico
7. Actualizar `popup.js` con lógica de Meet
8. Instalar OpenAI SDK en `apps/api`
9. Crear `apps/api/src/routes/transcribe.ts`
10. Registrar la ruta en `apps/api/src/index.ts`
11. Actualizar `config.ts` con `openai.apiKey`
12. Probar con un daily real

## Lo que viene después (Fase 2 de voice)

- Diarización con AssemblyAI — detectar quién habla
- Guardar transcripción raw como archivo `.md` separado en el vault
- `brain meet --list` — ver historial de meets transcritos
- Zoom y Teams providers