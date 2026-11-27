/* HTTP battery, unified-billing stage: the pager included with a paid Mirqam Loyalty plan.
   Boots the API the way production runs it (BILLING_URL set, signed entitlement webhooks, the POS bridge
   key), against two small fakes started here: mirqam-billing and the POS API's loyalty bridge. Drives a
   workspace's Loyalty plan paid → lapsed → paid again with signed webhooks and checks the pager follows.
   Run by scripts/verify.mjs; standalone: node tests/http/unified/run.mjs */
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SECRET = 'unified-gate-webhook-secret'
const BILLING_KEY = 'b'.repeat(64)
const BRIDGE_KEY = 'unified-gate-pos-bridge-key-0123456789abcdef'

/** Starts an HTTP server on a free port; `handler(req, body)` returns [status, json]. */
function fake(handler) {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', async () => {
        const [status, body] = await handler(req, raw ? JSON.parse(raw) : null)
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }))
  })
}

// mirqam-billing: nothing is subscribed through it in this stage except what the webhooks say.
const billingCalls = []
const billing = await fake(async (req) => {
  billingCalls.push(`${req.method} ${req.url}`)
  if (req.url.startsWith('/v1/entitlements/')) return [200, { status: 'none', allowed: false }]
  if (req.url.startsWith('/v1/catalog')) return [200, { plans: [] }]
  if (req.url.startsWith('/v1/portal/')) return [200, { entitlement: null, invoices: [] }]
  return [200, {}]
})

// The POS API's loyalty bridge: records every push; answers the Pager tab's state read.
const pushes = []
const pos = await fake(async (req, body) => {
  if (req.headers.authorization !== `Bearer ${BRIDGE_KEY}`) return [401, { code: 'unauthenticated' }]
  if (req.method === 'POST' && req.url === '/v1/loyalty-bridge/pager') {
    pushes.push(body)
    return [200, { posTenantId: `pos-${body.loyaltyTenantId.slice(0, 8)}`, created: pushes.length === 1 }]
  }
  const m = /^\/v1\/loyalty-bridge\/pager\/([0-9a-f-]{36})$/.exec(req.url)
  if (req.method === 'GET' && m) {
    const last = pushes.filter((p) => p.loyaltyTenantId === m[1]).at(-1)
    if (!last?.active) return [403, { code: 'pager_off' }]
    return [
      200,
      {
        posTenantId: `pos-${m[1].slice(0, 8)}`,
        managedInPos: false,
        plan: { tier: last.plan, plusFeatures: last.plan === 'plus', branchLimit: last.branches, allowedBranchIds: ['b1'] },
        settings: { enabled: true, sound: 'chime', expiryHours: 12 },
        branches: [{ id: 'b1', name: 'Main', slug: 'main', active: true, inPlan: true, counterUrl: 'http://pos.example/c/main' }],
        brand: { name: 'Shop', nameAr: 'متجر', logoUrl: null, primaryColor: '#172740', accentColor: '#8AC0C4' },
      },
    ]
  }
  return [404, { code: 'not_found' }]
})

function freePort() {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}
const port = await freePort()
const base = `http://localhost:${port}`
const server = spawn(process.execPath, ['apps/api/src/server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: process.env.VERIFY_DATABASE_URL || 'memory://',
    PUBLIC_URL: base,
    AUTH_RATE_LIMIT: '1000',
    WEB_DIST: join(ROOT, '.verify-no-dist'),
    SECRET_KEY: 'verify-gate-secret',
    BILLING_URL: billing.url,
    BILLING_API_KEY: BILLING_KEY,
    BILLING_WEBHOOK_SECRET: SECRET,
    MIRQAM_POS_API_URL: pos.url.replace('127.0.0.1', 'localhost'),
    MIRQAM_POS_BRIDGE_KEY: BRIDGE_KEY,
  },
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
let healthy = false
for (let i = 0; i < 360 && !healthy; i++) {
  try {
    healthy = (await fetch(`${base}/api/health`)).ok
  } catch {}
  if (!healthy) await new Promise((r) => setTimeout(r, 250))
}

process.env.BASE = base
const { Agent, check, expect, expectStatus, key, summary } = await import('../harness.mjs')

/** A signed `entitlement.updated` for the workspace's Loyalty plan, as mirqam-billing sends it. */
let version = Date.now()
async function loyalty(tenantId, status, days) {
  version += 1
  const until = new Date(Date.now() + days * 86_400_000).toISOString()
  const body = JSON.stringify({
    type: 'entitlement.updated',
    data: { platform: 'loyalty', account_ref: tenantId, status, plan: 'loyalty', cycle: 'monthly', active_until: until, current_period_end: until, version },
  })
  const t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`
  const res = await fetch(`${base}/api/billing/hooks`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mirqam-signature': sig }, body })
  expect(res.status, 'webhook').toBe(200)
}
const lastPush = (tenantId) => pushes.filter((p) => p.loyaltyTenantId === tenantId).at(-1)

if (!healthy) {
  console.log(`FAIL server did not become healthy\n${serverLog}`)
} else {
  await check(
    'unified billing: paid Loyalty includes the pager (no checkout), a lapse turns it off with both ways back, paying again brings it back',
    async () => {
      const owner = await Agent.owner()
      const tenantId = owner.me.tenant.id
      // Loyalty on its free trial: the standalone pager offer, as today.
      const before = await owner.get('/api/billing/pager')
      expectStatus(before, 200)
      expect(before.body.included, 'included on the Loyalty trial').toBe(false)
      expect(before.body.trialAvailable, 'pager trial on the Loyalty trial').toBe(true)

      // Loyalty paid: included, nothing to buy.
      await loyalty(tenantId, 'active', 30)
      const paid = await owner.get('/api/billing/pager')
      expect(paid.body.included, 'included once Loyalty is paid').toBe(true)
      expect(paid.body.purchasable, 'nothing to buy').toBe(false)
      expect(paid.body.subscription.source, 'source').toBe('loyalty')
      expectStatus(
        await owner.post('/api/billing/pager/checkout', { tier: 'plus', cycle: 'monthly', branches: 1 }, { headers: { 'idempotency-key': key() } }),
        409,
        'pager_included',
      )
      expectStatus(await owner.post('/api/billing/pager/trial', { tier: 'basic' }), 409, 'pager_included')
      // First visit to the Pager tab: the POS business is made through the bridge, and the counter opens.
      const live = await owner.get('/api/pager')
      expectStatus(live, 200)
      expect(live.body.status, 'Pager tab').toBe('live')
      expect(lastPush(tenantId)?.active, 'POS on').toBe(true)
      expect(lastPush(tenantId)?.plan, 'included tier').toBe('plus')
      expect(
        billingCalls.some((c) => c.includes('checkout-sessions')),
        'no checkout',
      ).toBe(false)

      // Loyalty lapses: the pager turns off through the bridge; the tab offers renewing Loyalty or the standalone plan.
      await loyalty(tenantId, 'expired', -1)
      expect(lastPush(tenantId)?.active, 'POS off after the lapse').toBe(false)
      const off = await owner.get('/api/pager')
      expectStatus(off, 200)
      expect(off.body.status, 'Pager tab after the lapse').toBe('no_plan')
      expect(off.body.plan.lapsedFromLoyalty, 'both ways back').toBe(true)
      expect(off.body.plan.purchasable, 'standalone on sale').toBe(true)
      expect(off.body.plan.prices.plus.monthly, 'standalone price').toBe(4900)

      // Loyalty paid again: on by itself.
      await loyalty(tenantId, 'active', 30)
      expect(lastPush(tenantId)?.active, 'POS on again').toBe(true)
      expect((await owner.get('/api/pager')).body.status, 'Pager tab after paying again').toBe('live')
    },
  )
}

server.kill()
billing.srv.close()
pos.srv.close()
const failed = summary()
if (/\[api\] (GET|POST|PATCH|DELETE|PUT) /.test(serverLog)) {
  console.log('\nServer reported unhandled errors during the stage:')
  console.log(
    serverLog
      .split('\n')
      .filter((l) => /\[api\]|Error/.test(l))
      .slice(0, 20)
      .join('\n'),
  )
  process.exit(1)
}
process.exit(failed || !healthy ? 1 : 0)
