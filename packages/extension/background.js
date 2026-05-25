// ── Meet: grabación via offscreen document (MV3) ─────────────────
let recordingState = {
  isRecording: false,
  startTime: null,
  tabId: null,
  url: null,
}

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html')

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  })
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Grabación de audio del tab de Meet',
    })
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_RECORDING_STATE') {
    sendResponse(recordingState)
    return true
  }

  if (msg.type === 'START_RECORDING') {
    chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId }, async (streamId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      try {
        await ensureOffscreen()
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_START_CAPTURE', streamId }, response => {
          if (response?.ok) {
            recordingState = {
              isRecording: true,
              startTime: Date.now(),
              tabId: msg.tabId,
              url: msg.url,
            }
            sendResponse({ ok: true })
          } else {
            sendResponse({ ok: false, error: response?.error || 'Error al capturar audio' })
          }
        })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })
    return true
  }

  if (msg.type === 'STOP_RECORDING') {
    const meetUrl = recordingState.url
    const startTime = recordingState.startTime
    recordingState = { isRecording: false, startTime: null, tabId: null, url: null }

    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' }, async response => {
      if (response?.ok) {
        const duration = Math.floor((Date.now() - startTime) / 1000)
        chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Transcribiendo...' })
        await sendToAPI(response.base64, duration, meetUrl, startTime)
      } else {
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPTION_ERROR',
          error: response?.error || 'Error al procesar audio',
        })
      }
    })

    sendResponse({ ok: true })
    return true
  }
})

async function sendToAPI(base64, duration, meetUrl, startTime) {
  try {
    const { apiUrl, apiSecret } = await chrome.storage.sync.get(['apiUrl', 'apiSecret'])
    if (!apiUrl) throw new Error('API URL no configurada')

    chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Enviando a la API...' })

    const res = await fetch(`${apiUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret || 'brain-log-secret',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ audio: base64, duration, meetUrl, source: 'browser', startTime }),
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

// ── Context menu: click derecho → capturar selección ─────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'brain-capture',
    title: 'brain-log: capturar selección',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'brain-capture') return
  const text = info.selectionText
  if (!text) return

  const { apiUrl, apiSecret } = await chrome.storage.sync.get(['apiUrl', 'apiSecret'])
  if (!apiUrl) return

  try {
    await fetch(`${apiUrl}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ type: 'note', raw: text, source: 'browser' }),
    })
  } catch (e) {
    console.error('brain-log: error saving capture', e)
  }
})
