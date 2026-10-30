import { runPurges } from './account-deletion.js'
import { createApp } from './app.js'
import { startCommerceWorker } from './commerce.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'

const config = loadConfig()
const db = await openDb(config.databaseUrl)
await migrate(db, { log: console.log })

const app = createApp({ db, config })
const stopCommerce = startCommerceWorker(app.locals.commerceBilling)
const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${server.address().port} (db: ${db.kind}${config.production ? ', production' : ''})`)
})

// Subscription lifecycle: expiry reminders, expiry events and the email outbox.
const runLifecycle = () =>
  app.locals.billing
    .runLifecycle()
    .then((c) => (c.reminded || c.expired || c.emailed) && console.log('[billing] lifecycle', JSON.stringify(c)))
    .catch((err) => console.warn('[billing] lifecycle failed:', err.message))
setTimeout(runLifecycle, 30_000).unref()
setInterval(runLifecycle, config.lifecycleIntervalMs).unref()

// Account deletion: purges deleted owners' workspaces the request could not finish, and
// billing records past their legal retention (account-deletion.js).
const runDeletionSweep = () =>
  runPurges(db, { wallet: app.locals.wallet })
    .then((c) => (c.purged || c.failed || c.billingRecordsExpired || c.tombstonesRemoved) && console.log('[deletion] sweep', JSON.stringify(c)))
    .catch((err) => console.warn('[deletion] sweep failed:', err.message))
setTimeout(runDeletionSweep, 45_000).unref()
setInterval(runDeletionSweep, config.purgeIntervalMs).unref()

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[api] ${signal} — shutting down`)
  stopCommerce()
  server.close()
  await db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
