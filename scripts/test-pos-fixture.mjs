import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createApp } from '../apps/api/src/app.js'
import { loadConfig } from '../apps/api/src/config.js'
import { adjust, ensureAccount } from '../apps/api/src/ledger.js'
import { freshDb, seedTenant } from '../apps/api/src/testing.js'

const db = await freshDb(),
  s = await seedTenant(db),
  token = randomBytes(32).toString('base64url'),
  link = randomBytes(32).toString('base64url')
await db.query('UPDATE members SET phone=$2 WHERE id=$1', [s.memberId, '+966500000001'])
const a = await ensureAccount(db, s)
await adjust(db, { tenantId: s.tenantId, accountId: a.id, points: 100, idempotencyKey: 'opening-balance', note: 'Synthetic test only' })
await db.query('INSERT INTO pos_account_links(key,tenant_id,data) VALUES($1,$2,$3)', [
  'link:' + link,
  s.tenantId,
  { identity: { id: s.tenantId }, active: true, posTenant: process.env.POS_TENANT, loyaltyAccessHash: createHash('sha256').update(token).digest('base64url') },
])
const app = createApp({ db, config: loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'http://localhost', AUTH_RATE_LIMIT: '10000' }) })
const server = createServer(app).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
console.log(JSON.stringify({ url: 'http://127.0.0.1:' + server.address().port, token, link, programId: s.programId }))
process.on('SIGTERM', () =>
  server.close(async () => {
    await db.close()
    process.exit(0)
  }),
)
