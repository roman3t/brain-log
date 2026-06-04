let mediaRecorder = null
let currentChunks = []
let headerChunk = null
let audioContext = null
let stream = null
let chunkInterval = null
let chunkStartTime = null


let apiUrl = null
let apiSecret = 'brain-log-secret'
let meetUrl = null
let sessionStartTime = null
let sessionContext = ''
let chunkCount = 0

const CHUNK_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_START_CAPTURE') {
    startCapture(msg.streamId, msg.meetUrl, msg.startTime)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture()
  }
})

async function startCapture(streamId, url, startTime) {
  const creds = await chrome.storage.sync.get(['apiUrl', 'apiSecret'])
  apiUrl = creds.apiUrl || null
  apiSecret = creds.apiSecret || 'brain-log-secret'
  meetUrl = url || null
  sessionStartTime = startTime || Date.now()
  sessionContext = ''
  chunkCount = 0

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })

  audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  source.connect(audioContext.destination)

  currentChunks = []
  headerChunk = null
  chunkStartTime = Date.now()

  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm', audioBitsPerSecond: 32000 })
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) {
      if (!headerChunk) headerChunk = e.data
      currentChunks.push(e.data)
    }
  }
  mediaRecorder.start(1000)

  chunkInterval = setInterval(flushCurrentChunks, CHUNK_INTERVAL_MS)
}

function buildBlob() {
  const blobParts = headerChunk && currentChunks[0] !== headerChunk
    ? [headerChunk, ...currentChunks]
    : [...currentChunks]
  return new Blob(blobParts, { type: 'audio/webm' })
}

async function flushCurrentChunks() {
  if (!currentChunks.length) return

  const blob = buildBlob()
  const arrayBuffer = await blob.arrayBuffer()
  const base64 = arrayBufferToBase64(arrayBuffer)

  const duration = Math.floor((Date.now() - chunkStartTime) / 1000)
  currentChunks = []
  chunkStartTime = Date.now()

  await uploadChunk(base64, duration)
}

async function uploadChunk(base64, duration) {
  if (!apiUrl) return
  try {
    const res = await fetch(`${apiUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ audio: base64, duration, isChunk: true, previousContext: sessionContext }),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.lastWords) sessionContext = data.lastWords
      chunkCount++
      chrome.runtime.sendMessage({
        type: 'CHUNK_SENT',
        chunkNumber: chunkCount,
        capturesCount: data.capturesCount ?? 0,
      })
    } else {
      const err = await res.json().catch(() => ({}))
      console.error('brain-log: chunk API error', err)
      chrome.runtime.sendMessage({ type: 'CHUNK_ERROR', chunkNumber: chunkCount + 1 })
    }
  } catch (err) {
    console.error('brain-log: error sending audio chunk', err)
    chrome.runtime.sendMessage({ type: 'CHUNK_ERROR', chunkNumber: chunkCount + 1 })
  }
}

function cleanup() {
  if (audioContext) { audioContext.close(); audioContext = null }
  mediaRecorder = null
  stream = null
}

async function stopCapture() {
  clearInterval(chunkInterval)
  chunkInterval = null

  if (!mediaRecorder) {
    chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_DONE', capturesCount: 0, recap: null })
    return
  }

  let finalBlob
  try {
    finalBlob = await new Promise((resolve, reject) => {
      mediaRecorder.onstop = () => {
        try {
          resolve(currentChunks.length ? buildBlob() : null)
        } catch (err) {
          reject(err)
        }
      }
      mediaRecorder.stop()
      stream.getTracks().forEach(t => t.stop())
    })
  } catch (err) {
    cleanup()
    chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_ERROR', error: err.message })
    return
  }

  const duration = Math.floor((Date.now() - chunkStartTime) / 1000)
  cleanup()

  if (!finalBlob) {
    chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_DONE', capturesCount: 0, recap: null })
    return
  }

  await uploadFinal(finalBlob, duration)
}

async function uploadFinal(blob, duration) {
  if (!apiUrl) {
    chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_ERROR', error: 'API URL no configurada' })
    return
  }
  try {
    chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Transcribiendo...' })
    const arrayBuffer = await blob.arrayBuffer()
    const base64 = arrayBufferToBase64(arrayBuffer)

    chrome.runtime.sendMessage({ type: 'PROCESSING_STATUS', status: 'Enviando a la API...' })
    const res = await fetch(`${apiUrl}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret,
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        audio: base64,
        duration,
        meetUrl,
        source: 'browser',
        startTime: sessionStartTime,
        previousContext: sessionContext,
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
    chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_ERROR', error: err.message })
  }
}
