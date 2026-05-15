// Responde con el texto seleccionado cuando el popup lo pida
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_SELECTION') {
    sendResponse({ text: window.getSelection()?.toString() || '' })
  }
  return true
})
