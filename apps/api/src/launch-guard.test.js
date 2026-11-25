/* Go-live guard of the region move (launch-guard.js, MIGRATION.md): a service
   declared with MIRQAM_REQUIRE_LIVE=1 must not start the app on an empty
   database, and Oregon (no MIRQAM_REQUIRE_LIVE) must be unaffected. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'
import { hasLoyaltyData, requiresLoyaltyData } from './launch-guard.js'
import { startServer } from './main.js'
import { freshDb, seedTenant } from './testing.js'

describe('requiresLoyaltyData', () => {
  it('applies only to MIRQAM_REQUIRE_LIVE services without the migration-complete marker', () => {
    expect(requiresLoyaltyData({})).toBe(false)
    expect(requiresLoyaltyData({ MIRQAM_LIVE: '1' })).toBe(false)
    expect(requiresLoyaltyData({ MIRQAM_READ_ONLY: '1' })).toBe(false)
    expect(requiresLoyaltyData({ MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1' })).toBe(true)
    expect(requiresLoyaltyData({ MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1', MIRQAM_MIGRATION_COMPLETE: '0' })).toBe(true)
    expect(requiresLoyaltyData({ MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1', MIRQAM_MIGRATION_COMPLETE: '1' })).toBe(false)
  })
})

describe('hasLoyaltyData', () => {
  it('is false for a database without the schema and for a migrated empty one, true once a workspace exists', async () => {
    const bare = await openDb('memory://')
    expect(await hasLoyaltyData(bare)).toBe(false)
    await bare.close()

    const db = await freshDb()
    expect(await hasLoyaltyData(db)).toBe(false)
    await seedTenant(db)
    expect(await hasLoyaltyData(db)).toBe(true)
    await db.close()
  })
})

describe('startServer with requireData', () => {
  it('refuses an empty database before migrating anything', async () => {
    const before = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'memory://'
    try {
      const started = await startServer({ requireData: true })
      expect(started.refused).toMatch(/MIRQAM_LIVE=1 refused.*MIRQAM_MIGRATION_COMPLETE/)
      expect(started.server).toBeUndefined()
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = before
    }
  })
})

/* The real entry point, as Render runs it. */
describe('server.js boot', () => {
  const dirs = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  const freePort = () =>
    new Promise((resolve, reject) => {
      const srv = createServer()
      srv.on('error', reject)
      srv.listen(0, () => {
        const { port } = srv.address()
        srv.close(() => resolve(port))
      })
    })

  async function boot(env) {
    const port = await freePort()
    const child = spawn(process.execPath, [join(import.meta.dirname, 'server.js')], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test', WEB_DIST: '/nonexistent', PORT: String(port), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    try {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}):\n${output}`)
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`)
          if (res.ok) return { health: await res.json(), output }
        } catch {}
        await new Promise((r) => setTimeout(r, 200))
      }
      throw new Error(`no health answer:\n${output}`)
    } finally {
      child.kill('SIGTERM')
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)))
    }
  }

  async function seededDir() {
    const dir = mkdtempSync(join(tmpdir(), 'mp-guard-'))
    dirs.push(dir)
    const db = await openDb(`pglite://${dir}`)
    await migrate(db)
    await seedTenant(db)
    await db.close()
    return `pglite://${dir}`
  }

  it('Oregon (no MIRQAM_REQUIRE_LIVE) starts live on an empty database, as before', async () => {
    const { health } = await boot({ DATABASE_URL: 'memory://' })
    expect(health.ok).toBe(true)
    expect(health.standby).toBeUndefined()
    expect(health.db).toBe('pglite')
  }, 30_000)

  it('Frankfurt with MIRQAM_LIVE=1 on an empty database stays in standby and says why', async () => {
    const { health, output } = await boot({ DATABASE_URL: 'memory://', MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1' })
    expect(health).toMatchObject({ ok: true, standby: true, reason: 'empty_database' })
    expect(output).toMatch(/\[launch\] MIRQAM_LIVE=1 refused/)
    expect(output).not.toMatch(/\[db\] applied/)
  }, 30_000)

  it('Frankfurt starts live once the copied data is there', async () => {
    const { health } = await boot({ DATABASE_URL: await seededDir(), MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1' })
    expect(health.ok).toBe(true)
    expect(health.standby).toBeUndefined()
  }, 30_000)

  it('MIRQAM_MIGRATION_COMPLETE=1 lets a deliberately empty database go live', async () => {
    const { health } = await boot({ DATABASE_URL: 'memory://', MIRQAM_REQUIRE_LIVE: '1', MIRQAM_LIVE: '1', MIRQAM_MIGRATION_COMPLETE: '1' })
    expect(health.ok).toBe(true)
    expect(health.standby).toBeUndefined()
  }, 30_000)

  it('without MIRQAM_LIVE the service stays in plain standby', async () => {
    const { health } = await boot({ DATABASE_URL: 'memory://', MIRQAM_REQUIRE_LIVE: '1' })
    expect(health).toEqual({ ok: true, standby: true, version: expect.any(String) })
  }, 30_000)
})
