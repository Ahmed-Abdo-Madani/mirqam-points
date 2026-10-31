/* The Frankfurt move (RUNBOOK.md): runtime modes, the database copy, the
   write freeze and the forwarder. Databases are in-memory PGlite (real
   Postgres): the copy needs two independent single-connection sessions. */
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { CopyError, copyDatabase, verifyDatabase } from './db/copy.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'
import { createForwarder, FORWARD_HEADER, signForwarded, verifyForwarded } from './forwarder.js'
import { earn, ensureAccount, voidEntry } from './ledger.js'
import { runtimeMode, upstreamOrigin } from './runtime-mode.js'
import { createStandbyServer } from './standby.js'
import { seedTenant } from './testing.js'

const quiet = () => {}
let n = 0
const key = () => `move-key-${++n}-${Math.random().toString(36).slice(2)}`

async function migrated() {
  const db = await openDb('memory://')
  await migrate(db)
  return db
}

async function seed(db) {
  const t = await seedTenant(db)
  const acct = await ensureAccount(db, t)
  const a = { ...t, accountId: acct.id }
  await earn(db, { ...a, points: 120, idempotencyKey: key(), purchaseMinor: 12000 })
  const e2 = await earn(db, { ...a, points: 30, idempotencyKey: key() })
  // A void references an earlier entry of the same table (self-referencing foreign key).
  await voidEntry(db, { tenantId: t.tenantId, entryId: e2.entry.id, idempotencyKey: key() })
  await db.query(
    `INSERT INTO audit_log (tenant_id, action, target, data, created_at)
     VALUES ($1, 'move.test', 'x', '{"ar":"مرقام","list":[1,2.5,null]}'::jsonb, '2026-10-31 12:34:56.123456+00')`,
    [t.tenantId],
  )
  return a
}

const count = async (db, table) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n)

describe('runtime mode', () => {
  it('keeps a new service in standby until MIRQAM_LIVE=1 and lets FORWARD_TO win', () => {
    expect(runtimeMode({})).toEqual({ kind: 'live', readOnly: false })
    expect(runtimeMode({ MIRQAM_READ_ONLY: '1' })).toEqual({ kind: 'live', readOnly: true })
    expect(runtimeMode({ MIRQAM_REQUIRE_LIVE: '1' }).kind).toBe('standby')
    expect(runtimeMode({ MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '0' }).kind).toBe('standby')
    expect(runtimeMode({ MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1' }).kind).toBe('live')
    expect(runtimeMode({ MIRQAM_STANDBY: '1' }).kind).toBe('standby')
    expect(runtimeMode({ FORWARD_TO: 'https://mirqam-points-fra.onrender.com/', MIRQAM_READ_ONLY: '1' })).toEqual({
      kind: 'forward',
      upstream: 'https://mirqam-points-fra.onrender.com',
    })
  })

  it('accepts only a bare origin as the forward target', () => {
    for (const bad of ['mirqam-points-fra.onrender.com', 'ftp://x.example', 'https://x.example/api', 'https://u:p@x.example', 'https://x.example/?a=1']) {
      expect(() => upstreamOrigin(bad)).toThrow()
    }
  })

  it('standby answers health checks only', async () => {
    const server = createStandbyServer({ version: 'test' })
    await new Promise((r) => server.listen(0, r))
    const base = `http://127.0.0.1:${server.address().port}`
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, standby: true, version: 'test' })
    const other = await fetch(`${base}/api/auth/me`)
    expect(other.status).toBe(503)
    expect(await other.json()).toEqual({ error: 'maintenance' })
    server.close()
  })
})

describe('database copy', () => {
  let source
  let target
  beforeAll(async () => {
    source = await migrated()
    target = await migrated()
    await seed(source)
    await seed(source)
  })
  afterAll(async () => {
    await source.close()
    await target.close()
  })

  it('copies every table, verifies it, and continues identity sequences', async () => {
    const lines = []
    const result = await copyDatabase({ source, target, mode: 'copy', log: (l) => lines.push(l), batchRows: 2 })
    expect(result.rows).toBeGreaterThan(10)
    expect(lines.some((l) => l.startsWith('FAIL'))).toBe(false)
    for (const table of ['tenants', 'members', 'accounts', 'ledger_entries', 'audit_log']) expect(await count(target, table)).toBe(await count(source, table))
    // Lossless: microseconds and jsonb survive.
    const row = (await target.query(`SELECT created_at::text AS at, data FROM audit_log WHERE action = 'move.test' ORDER BY id LIMIT 1`)).rows[0]
    expect(row.at).toBe('2026-10-31 12:34:56.123456+00')
    expect(row.data).toEqual({ ar: 'مرقام', list: [1, 2.5, null] })
    // The identity sequence continues after the copied rows.
    const maxId = Number((await target.query('SELECT max(id) AS m FROM audit_log')).rows[0].m)
    const { rows } = await target.query(`INSERT INTO audit_log (tenant_id, action) SELECT id, 'after' FROM tenants LIMIT 1 RETURNING id`)
    expect(Number(rows[0].id)).toBeGreaterThan(maxId)
    // The foreign keys are back and enforced.
    await expect(target.query(`INSERT INTO members (tenant_id, phone) VALUES (gen_random_uuid(), '+966500000001')`)).rejects.toThrow()
    // The append-only trigger is still there.
    await expect(target.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/)
  })

  it('refuses to copy into a non-empty target, and replace re-copies atomically', async () => {
    await expect(copyDatabase({ source, target, mode: 'copy', log: quiet })).rejects.toBeInstanceOf(CopyError)
    // Target drifted (a row written after the first copy): verify notices, replace repairs.
    expect(await verifyDatabase({ source, target, log: quiet })).toBeGreaterThan(0)
    await seed(source)
    await copyDatabase({ source, target, mode: 'replace', log: quiet })
    expect(await verifyDatabase({ source, target, log: quiet })).toBe(0)
    expect(await count(target, 'ledger_entries')).toBe(await count(source, 'ledger_entries'))
  })

  it('verify detects changed content even with equal row counts', async () => {
    await source.query(`UPDATE tenants SET name = name || '!' WHERE id = (SELECT id FROM tenants ORDER BY id LIMIT 1)`)
    const lines = []
    expect(await verifyDatabase({ source, target, log: (l) => lines.push(l) })).toBe(1)
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/tenants: .*content differs/)
    await copyDatabase({ source, target, mode: 'replace', log: quiet })
    expect(await verifyDatabase({ source, target, log: quiet })).toBe(0)
  })

  it('refuses mismatched releases and leaves the target unchanged', async () => {
    const older = await openDb('memory://')
    await migrate(older)
    await older.query(`DELETE FROM schema_migrations WHERE name = (SELECT max(name) FROM schema_migrations)`)
    const before = await count(target, 'tenants')
    await expect(copyDatabase({ source: older, target, mode: 'replace', log: quiet })).rejects.toThrow(/migrations differ/)
    expect(await count(target, 'tenants')).toBe(before)
    await older.close()
  })

  it('refuses to copy a database onto itself (same session)', async () => {
    await expect(copyDatabase({ source, target: source, mode: 'replace', log: quiet })).rejects.toThrow(/same database/)
  })
})

/* The read-only (write freeze) app and the forwarder in front of a live app. */
/** Raw HTTP request (fetch cannot set Host). */
function send(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

function listen(handler) {
  const server = handler instanceof http.Server ? handler : http.createServer(handler)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })))
}

describe('write freeze', () => {
  it('serves reads, refuses writes with 503 maintenance, and the database refuses writes too', async () => {
    const db = await migrated()
    await db.close()
    const ro = await openDb('memory://', { readOnly: true })
    await expect(ro.query(`CREATE TABLE t (x int)`)).rejects.toThrow(/read-only/)
    await ro.close()

    const live = await migrated()
    const config = { ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'memory://', SECRET_KEY: 's' }), readOnly: true, webDist: '/nonexistent' }
    const { server, base } = await listen(createApp({ db: live, config }))
    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health).toMatchObject({ ok: true, readOnly: true })
    const write = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(write.status).toBe(503)
    expect(await write.json()).toEqual({ error: 'maintenance' })
    // The app's live-update check is a read and keeps working.
    const lu = await fetch(`${base}/api/mobile/live-update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(lu.status).toBe(200)
    server.close()
    await live.close()
  })
})

describe('forwarder', () => {
  const secretKey = 'shared-secret-key'

  it('signs the client address and host; forged, stale or unsigned statements are ignored', () => {
    const header = signForwarded(secretKey, { ip: '203.0.113.7', host: 'mirqam-points.onrender.com', proto: 'https' })
    expect(verifyForwarded(secretKey, header)).toEqual({ ip: '203.0.113.7', host: 'mirqam-points.onrender.com', proto: 'https' })
    expect(verifyForwarded('other-key', header)).toBeNull()
    expect(verifyForwarded(secretKey, header.replace(/\.[^.]+$/, '.AAAA'))).toBeNull()
    expect(verifyForwarded(secretKey, header, { now: Date.now() + 10 * 60_000 })).toBeNull()
    expect(verifyForwarded('', header)).toBeNull()
  })

  it('relays every request with its body, status, cookies and streaming, restoring the original host for the upstream', async () => {
    let seen
    const upstream = await listen((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `${upstreamBase}/app/billing?x=1` })
        return res.end()
      }
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: one\n\n')
        setTimeout(() => res.end('data: two\n\n'), 50)
        return
      }
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }
        res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] })
        res.end('{"ok":true}')
      })
    })
    const upstreamBase = upstream.base
    const fwd = await listen(createForwarder({ upstream: upstream.base, secretKey, trustProxy: 1, log: { warn: quiet } }))

    const res = await send(fwd.base, '/api/members?q=1', {
      method: 'POST',
      headers: {
        host: 'mirqam-points.onrender.com',
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.9',
        'x-forwarded-proto': 'https',
        authorization: 'Bearer t',
        [FORWARD_HEADER]: 'forged',
      },
      body: '{"name":"مرقام"}',
    })
    expect(res.status).toBe(201)
    expect(res.headers['x-mirqam-forwarder']).toBe('1')
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(JSON.parse(res.text)).toEqual({ ok: true })
    expect(seen).toMatchObject({ method: 'POST', url: '/api/members?q=1', body: '{"name":"مرقام"}' })
    expect(seen.headers).toMatchObject({ host: new URL(upstream.base).host, 'x-forwarded-host': 'mirqam-points.onrender.com', authorization: 'Bearer t' })
    expect(verifyForwarded(secretKey, seen.headers[FORWARD_HEADER])).toEqual({ ip: '198.51.100.9', host: 'mirqam-points.onrender.com', proto: 'https' })

    const redirect = await send(fwd.base, '/redirect', { headers: { 'x-forwarded-proto': 'https', host: 'loyalty.mirqam.sa' } })
    expect(redirect.headers.location).toBe('https://loyalty.mirqam.sa/app/billing?x=1')

    const stream = await fetch(`${fwd.base}/stream`)
    expect(await stream.text()).toBe('data: one\n\ndata: two\n\n')

    const local = await (await fetch(`${fwd.base}/__forwarder/health`)).json()
    expect(local).toEqual({ ok: true, forwarding: upstream.base })

    upstream.server.close()
    const down = await fetch(`${fwd.base}/api/health`)
    expect(down.status).toBe(502)
    fwd.server.close()
  })

  it('end to end: the upstream app sees the original host and client (same-origin writes, rate-limit identity)', async () => {
    const db = await migrated()
    const config = { ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'memory://', SECRET_KEY: secretKey, TRUST_PROXY: '1' }), webDist: '/nonexistent' }
    const app = createApp({ db, config })
    app.get('/__probe', (req, res) => res.json({ ip: req.ip, host: req.get('host'), protocol: req.protocol }))
    const upstream = await listen(app)
    const fwd = await listen(createForwarder({ upstream: upstream.base, secretKey, trustProxy: 1, log: { warn: quiet } }))
    const headers = { host: 'mirqam-points.onrender.com', 'x-forwarded-for': '198.51.100.9', 'x-forwarded-proto': 'https' }

    expect(JSON.parse((await send(fwd.base, '/__probe', { headers })).text)).toEqual({
      ip: '198.51.100.9',
      host: 'mirqam-points.onrender.com',
      protocol: 'https',
    })
    // A browser on the old host: its Origin is same-origin for the upstream, so the CSRF guard lets the write through.
    const write = { method: 'POST', headers: { ...headers, origin: 'https://mirqam-points.onrender.com', 'content-type': 'application/json' }, body: '{}' }
    const viaForwarder = await send(fwd.base, '/api/auth/login', write)
    expect(viaForwarder.status).not.toBe(403)
    // Without the forwarder's signature the same request is cross-origin for the upstream and refused.
    const { host: _host, ...withoutHost } = write.headers
    const unsigned = await send(upstream.base, '/api/auth/login', { ...write, headers: withoutHost })
    expect(JSON.parse(unsigned.text)).toEqual({ error: 'origin_not_allowed' })
    // Sent directly (no forwarder), a forged statement is ignored.
    const direct = JSON.parse((await send(upstream.base, '/__probe', { headers: { [FORWARD_HEADER]: 'x.y.z.https.sig' } })).text)
    expect(direct.host).toBe(new URL(upstream.base).host)

    fwd.server.close()
    upstream.server.close()
    await db.close()
  })
})
