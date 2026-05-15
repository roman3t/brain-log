// ── Tab switching ───────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    const target = tab.dataset.tab
    document.getElementById('tab-capture').style.display = target === 'capture' ? 'block' : 'none'
    document.getElementById('tab-settings').style.display = target === 'settings' ? 'block' : 'none'
  })
})

// ── Load settings ───────────────────────────────────────────────
chrome.storage.sync.get(['apiUrl', 'apiSecret'], ({ apiUrl, apiSecret }) => {
  if (apiUrl) document.getElementById('api-url').value = apiUrl
  if (apiSecret) document.getElementById('api-secret').value = apiSecret
  checkHealth(apiUrl, apiSecret)
})

// ── Jira detection ──────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs[0]?.url || ''
  const match = url.match(/(?:\/browse\/|[?&]selectedIssue=)([A-Z]+-\d+)/)
  if (!match) return

  const issueKey = match[1]
  const banner = document.getElementById('jira-banner')
  const keyEl = document.getElementById('jira-issue-key')
  const titleEl = document.getElementById('jira-issue-title')

  keyEl.textContent = issueKey
  banner.style.display = 'block'

  // Try to get title from page title
  if (tabs[0]?.title) {
    const pageTitle = tabs[0].title.replace(/\[.*?\]/, '').replace(issueKey, '').trim().replace(/^[-–—\s]+/, '')
    titleEl.textContent = pageTitle
  }

  document.getElementById('add-task-btn').addEventListener('click', async () => {
    const { apiUrl, apiSecret } = await new Promise(res =>
      chrome.storage.sync.get(['apiUrl', 'apiSecret'], res)
    )
    if (!apiUrl) {
      showJiraToast('Configura la API URL primero', 'error')
      return
    }
    const btn = document.getElementById('add-task-btn')
    btn.disabled = true
    btn.textContent = 'Guardando...'
    try {
      const res = await fetch(`${apiUrl}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiSecret || 'brain-log-secret',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify({ issueKey }),
      })
      const data = await res.json()
      if (res.ok) {
        btn.textContent = '✓ Guardado en Notion'
        btn.style.background = '#14532d'
        btn.style.borderColor = '#4ade80'
        btn.style.color = '#4ade80'
        if (data.issue?.title) titleEl.textContent = data.issue.title
      } else {
        btn.disabled = false
        btn.textContent = '+ Agregar a Tasks en Notion'
        showJiraToast(data.error || 'Error al guardar', 'error')
      }
    } catch {
      btn.disabled = false
      btn.textContent = '+ Agregar a Tasks en Notion'
      showJiraToast('No se pudo conectar con la API', 'error')
    }
  })
})

function showJiraToast(msg, type) {
  const el = document.getElementById('jira-toast')
  el.textContent = msg
  el.style.display = 'block'
  el.style.color = type === 'error' ? '#f87171' : '#4ade80'
  setTimeout(() => { el.style.display = 'none' }, 3000)
}

// ── Load selected text from content script ──────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!tabs[0]?.id) return
  chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SELECTION' }, response => {
    if (chrome.runtime.lastError) return
    if (response?.text?.trim()) {
      const preview = document.getElementById('selected-preview')
      const content = document.getElementById('selected-content')
      const input = document.getElementById('raw-input')
      preview.classList.add('visible')
      content.textContent = response.text.slice(0, 120) + (response.text.length > 120 ? '...' : '')
      input.value = response.text
    }
  })
})

// ── Health check ────────────────────────────────────────────────
async function checkHealth(apiUrl, apiSecret) {
  const dot = document.getElementById('status')
  if (!apiUrl) return
  dot.classList.remove('ok', 'err')
  try {
    const res = await fetch(`${apiUrl}/health`, { headers: { 'ngrok-skip-browser-warning': 'true' } })
    dot.classList.add(res.ok ? 'ok' : 'err')
  } catch {
    dot.classList.add('err')
  }
}

// ── Save capture ────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  const { apiUrl, apiSecret } = await new Promise(res =>
    chrome.storage.sync.get(['apiUrl', 'apiSecret'], res)
  )

  if (!apiUrl) {
    showToast('toast', 'Configura la API URL primero', 'error')
    return
  }

  const type = document.getElementById('type-select').value
  const raw = document.getElementById('raw-input').value.trim()

  if (!raw) {
    showToast('toast', 'Escribe algo primero', 'error')
    return
  }

  const btn = document.getElementById('save-btn')
  btn.disabled = true
  btn.textContent = 'Guardando...'

  try {
    const res = await fetch(`${apiUrl}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiSecret || 'brain-log-secret',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ type, raw, source: 'browser' }),
    })

    const data = await res.json()

    if (res.ok) {
      showToast('toast', '✓ Guardado en Notion', 'success')
      document.getElementById('raw-input').value = ''
      document.getElementById('selected-preview').classList.remove('visible')
    } else {
      showToast('toast', data.error || 'Error al guardar', 'error')
    }
  } catch (e) {
    showToast('toast', 'No se pudo conectar con la API', 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Guardar en Notion'
  }
})

// ── Save settings ────────────────────────────────────────────────
document.getElementById('save-settings').addEventListener('click', () => {
  const apiUrl = document.getElementById('api-url').value.trim().replace(/\/$/, '')
  const apiSecret = document.getElementById('api-secret').value.trim()
  chrome.storage.sync.set({ apiUrl, apiSecret }, () => {
    showToast('settings-toast', 'Configuración guardada', 'success')
    checkHealth(apiUrl, apiSecret)
  })
})

// ── Toast helper ────────────────────────────────────────────────
function showToast(id, msg, type) {
  const el = document.getElementById(id)
  el.textContent = msg
  el.className = `toast ${type}`
  setTimeout(() => { el.className = 'toast' }, 3000)
}
