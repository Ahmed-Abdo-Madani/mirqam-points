import { runPurges } from './account-deletion.js'
import { createApp } from './app.js'
import { startCommerceWorker } from './commerce.js'
import { loadConfig } from './config.js'
import { openDb } from './db/index.js'
import { migrate, pendingMigrations } from './db/migrate.js'
import { EMPTY_DATABASE_REASON, hasLoyaltyData } from './launch-guard.js'

/* The API + console (live mode), or the same app frozen for the cutover
   (read-only mode: writes refused, database session read only, no
   background job — runtime-mode.js).
   requireData (launch-guard.js): refuse to start on a database without loyalty
   data; returns { refused } before any migration or write, the caller stays in
   standby. */
export async function startServer({ readOnly = false, requireData = false } = {}) {
  const config = { ...loadConfig(), readOnly }
  const db = await openDb(config.databaseUrl, { readOnly })
  if (requireData && !(await hasLoyaltyData(db))) {
    await db.close().catch(() => {})
    return { refused: EMPTY_DATABASE_REASON }
  }
  if (readOnly) {
    // A read-only session cannot migrate; the release is expected to be migrated already.
    const pending = await pendingMigrations(db)
    if (pending.length) console.warn(`[db] read-only mode with ${pending.length} pending migration(s): ${pending.join(', ')}`)
  } else {
    await migrate(db, { log: console.log })
  }

  const app = createApp({ db, config })
  const server = app.listen(config.port, () => {
    console.log(
      `[api] listening on http://localhost:${server.address().port} (db: ${db.kind}${config.production ? ', production' : ''}${readOnly ? ', READ-ONLY: writes refused, no background jobs' : ''})`,
    )
  })

  // Background jobs run on the live service only: never on a frozen (read-only) one, so they
  // never run on two regions at once during the move.
  const stopJobs = readOnly ? () => {} : startJobs({ app, db, config })

  let closing = false
  async function shutdown(signal) {
    if (closing) return
    closing = true
    console.log(`[api] ${signal} — shutting down`)
    stopJobs()
    server.close()
    await db.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  return { app, server, db }
}

function startJobs({ app, db, config }) {
  const stopCommerce = startCommerceWorker(app.locals.commerceBilling)

  // Subscription lifecycle: expiry reminders, expiry events and the email outbox.
  const runLifecycle = () =>
    app.locals.billing
      .runLifecycle()
      .then((c) => (c.reminded || c.expired || c.emailed) && console.log('[billing] lifecycle', JSON.stringify(c)))
      .catch((err) => console.warn('[billing] lifecycle failed:', err.message))
  const timers = [setTimeout(runLifecycle, 30_000), setInterval(runLifecycle, config.lifecycleIntervalMs)]
  // Mirqam Pager plan: ends lapsed trials and retries POS pushes that failed.
  const runPagerLifecycle = () =>
    app.locals.pager
      ?.runLifecycle()
      .then((c) => c.pagerPushed && console.log('[pager] lifecycle', JSON.stringify(c)))
      .catch((err) => console.warn('[pager] lifecycle failed:', err.message))
  timers.push(setTimeout(runPagerLifecycle, 40_000), setInterval(runPagerLifecycle, Math.min(config.lifecycleIntervalMs, 900_000)))

  // Account deletion: purges deleted owners' workspaces the request could not finish, and
  // billing records past their legal retention (account-deletion.js).
  const runDeletionSweep = () =>
    runPurges(db, { wallet: app.locals.wallet })
      .then((c) => (c.purged || c.failed || c.billingRecordsExpired || c.tombstonesRemoved) && console.log('[deletion] sweep', JSON.stringify(c)))
      .catch((err) => console.warn('[deletion] sweep failed:', err.message))
  timers.push(setTimeout(runDeletionSweep, 45_000), setInterval(runDeletionSweep, config.purgeIntervalMs))
  for (const t of timers) t.unref()

  return () => {
    stopCommerce()
    for (const t of timers) clearTimeout(t)
  }
}
