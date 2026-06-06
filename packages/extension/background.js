let recordingState = {
  isRecording: false,
  startTime: null,
  tabId: null,
  url: null,
}

chrome.storage.local.get('recordingState', (stored) => {
  if (stored.recordingState?.isRecording) {
    recordingState = stored.recordingState
  }
})

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

// Manda OFFSCREEN_START_CAPTURE al offscreen y reintenta si aún no registró su
// listener (createDocument puede resolver antes de que el script corra): en ese
// caso la respuesta llega undefined o con error de conexión.
function startOffscreenCapture(payload, attempt = 0) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const failed = chrome.runtime.lastError || response === undefined
      if (failed && attempt < 8) {
        setTimeout(() => startOffscreenCapture(payload, attempt + 1).then(resolve), 100)
        return
      }
      if (failed) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message || 'el offscreen no respondió' })
        return
      }
      resolve(response)
    })
  })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_RECORDING_STATE') {
    chrome.storage.local.get('recordingState', ({ recordingState: stored }) => {
      sendResponse(stored?.isRecording ? stored : recordingState)
    })
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
        // El offscreen no tiene acceso a chrome.storage, así que le pasamos las
        // credenciales (que sí leemos aquí) en el mensaje de inicio.
        const { apiUrl, apiSecret } = await chrome.storage.sync.get(['apiUrl', 'apiSecret'])
        const startTime = Date.now()
        const response = await startOffscreenCapture({
          type: 'OFFSCREEN_START_CAPTURE',
          streamId,
          meetUrl: msg.url,
          startTime,
          apiUrl,
          apiSecret,
        })
        if (response?.ok) {
          recordingState = {
            isRecording: true,
            startTime,
            tabId: msg.tabId,
            url: msg.url,
          }
          chrome.storage.local.set({ recordingState })
          sendResponse({ ok: true })
        } else {
          sendResponse({ ok: false, error: response?.error || 'Error al capturar audio' })
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })
    return true
  }

  if (msg.type === 'STOP_RECORDING') {
    recordingState = { isRecording: false, startTime: null, tabId: null, url: null }
    chrome.storage.local.remove('recordingState')

    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE' })
    sendResponse({ ok: true })
    return true
  }
})

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
