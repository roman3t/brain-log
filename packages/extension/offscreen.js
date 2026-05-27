let mediaRecorder = null
let currentChunks = []
let headerChunk = null
let audioContext = null
let stream = null
let chunkInterval = null

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
    startCapture(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (msg.type === 'OFFSCREEN_STOP_CAPTURE') {
    stopCapture()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }
})

async function startCapture(streamId) {
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

async function flushCurrentChunks() {
  if (!currentChunks.length) return

  const blobParts = headerChunk && currentChunks[0] !== headerChunk
    ? [headerChunk, ...currentChunks]
    : [...currentChunks]

  const blob = new Blob(blobParts, { type: 'audio/webm' })
  const arrayBuffer = await blob.arrayBuffer()
  const base64 = arrayBufferToBase64(arrayBuffer)

  currentChunks = []

  chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', base64 })
}

async function stopCapture() {
  clearInterval(chunkInterval)
  chunkInterval = null

  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No hay grabación activa'))
      return
    }

    mediaRecorder.onstop = async () => {
      try {
        if (!currentChunks.length) {
          if (audioContext) { audioContext.close(); audioContext = null }
          resolve({ ok: true, base64: null })
          return
        }

        const blobParts = headerChunk && currentChunks[0] !== headerChunk
          ? [headerChunk, ...currentChunks]
          : [...currentChunks]

        const blob = new Blob(blobParts, { type: 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = arrayBufferToBase64(arrayBuffer)
        if (audioContext) { audioContext.close(); audioContext = null }
        resolve({ ok: true, base64 })
      } catch (err) {
        reject(err)
      }
    }

    mediaRecorder.stop()
    stream.getTracks().forEach(t => t.stop())
  })
}
