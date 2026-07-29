const requestCountEl = document.getElementById('requestCount')
const averageTimeEl = document.getElementById('averageTime')
const appStatusEl = document.getElementById('appStatus')
const statusBadgeEl = document.getElementById('statusBadge')
const statusTextEl = document.getElementById('statusText')
const lastUpdatedEl = document.getElementById('lastUpdated')

function setStatus(isUp) {
  statusBadgeEl.classList.remove('up', 'down')
  appStatusEl.classList.remove('up', 'down')

  if (isUp) {
    statusBadgeEl.classList.add('up')
    appStatusEl.classList.add('up')
    statusTextEl.textContent = 'Online'
    appStatusEl.textContent = 'Up'
    return
  }

  statusBadgeEl.classList.add('down')
  appStatusEl.classList.add('down')
  statusTextEl.textContent = 'Offline'
  appStatusEl.textContent = 'Down'
}

async function fetchStats() {
  try {
    const response = await fetch('/api/stats')

    if (!response.ok) {
      throw new Error('Stats request failed')
    }

    const data = await response.json()

    requestCountEl.textContent = data.requestCount.toLocaleString()
    averageTimeEl.textContent = `${data.averageResponseTime.toFixed(3)}s`
    setStatus(data.status === 'up')
    lastUpdatedEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`
  } catch (error) {
    requestCountEl.textContent = '—'
    averageTimeEl.textContent = '—'
    setStatus(false)
    lastUpdatedEl.textContent = 'Last updated: failed to connect'
  }
}

fetchStats()
setInterval(fetchStats, 5000)
