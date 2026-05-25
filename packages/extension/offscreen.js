let mediaRecorder = null
let audioChunks = []

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
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })

  audioChunks = []
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) audioChunks.push(e.data)
  }
  mediaRecorder.start(1000)
}

async function stopCapture() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No hay grabación activa'))
      return
    }

    mediaRecorder.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
        const arrayBuffer = await audioBlob.arrayBuffer()
        const base64 = arrayBufferToBase64(arrayBuffer)
        resolve({ ok: true, base64 })
      } catch (err) {
        reject(err)
      }
    }

    mediaRecorder.stop()
    mediaRecorder.stream.getTracks().forEach(t => t.stop())
  })
}
