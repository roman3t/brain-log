// Context menu: click derecho → capturar selección
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
        'x-api-key': apiSecret || 'brain-log-secret',
      },
      body: JSON.stringify({ type: 'note', raw: text, source: 'browser' }),
    })
  } catch (e) {
    console.error('brain-log: error saving capture', e)
  }
})
