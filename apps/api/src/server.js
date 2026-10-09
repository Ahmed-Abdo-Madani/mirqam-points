import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'

const config = loadConfig()
const db = await openDb(config.databaseUrl)
await migrate(db, { log: console.log })

const app = createApp({ db, config })
const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${server.address().port} (db: ${db.kind}${config.production ? ', production' : ''})`)
})

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[api] ${signal} — shutting down`)
  server.close()
  await db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
