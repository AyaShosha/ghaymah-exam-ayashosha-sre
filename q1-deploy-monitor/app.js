const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const port = 5000
const logDir = '/logs'
const logFile = path.join(logDir, 'logs.txt')

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

function getStatsFromLogFile() {
  if (!fs.existsSync(logFile)) {
    return { requestCount: 0, averageResponseTime: 0 }
  }

  const content = fs.readFileSync(logFile, 'utf8')
  const lines = content.split('\n').filter(Boolean)
  const requestCount = lines.length

  if (requestCount === 0) {
    return { requestCount: 0, averageResponseTime: 0 }
  }

  const totalResponseTime = lines.reduce((total, line) => {
    const parts = line.trim().split(' ')
    const duration = parseFloat(parts[1])
    return total + (Number.isNaN(duration) ? 0 : duration)
  }, 0)

  return {
    requestCount,
    averageResponseTime: totalResponseTime / requestCount
  }
}

app.use('/dashboard', express.static(path.join(__dirname, 'dashboard'), { index: false }))

app.use((req, res, next) => {
  const startTime = Date.now()
  const requestTime = new Date(startTime).toISOString()

  res.on('finish', () => {
    const durationSeconds = (Date.now() - startTime) / 1000
    const line = `${req.path} ${durationSeconds.toFixed(3)} ${requestTime} ${res.statusCode}\n`

    fs.appendFile(logFile, line, (err) => {
      if (err) console.error('Failed to write request log:', err)
    })
  })

  next()
})

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'))
})

app.get('/api/stats', (req, res) => {
  const { requestCount, averageResponseTime } = getStatsFromLogFile()

  res.json({
    requestCount,
    averageResponseTime,
    status: 'up'
  })
})

app.get('/', (req, res) => {
  res.send('Hello World from GHAYMAH')
})

app.get('/health', (req, res) => {
  res.send('The app up and runing')
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
  console.log(`Dashboard available at http://localhost:${port}/dashboard`)
})
