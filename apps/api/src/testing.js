/* Test fixtures: a fresh database with migrations applied, plus helpers that
   insert the minimal rows a ledger test needs.
   Default: in-memory PGlite. Set TEST_DATABASE_URL=postgres://… (CI does) to
   run the same suites against real Postgres through node-postgres — the
   schema is dropped and recreated, so never point it at a database you need. */
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'

export async function freshDb() {
  const url = process.env.TEST_DATABASE_URL
  if (url) {
    if (!/test/i.test(url)) throw new Error('TEST_DATABASE_URL must name a test database (contain "test")')
    const db = await openDb(url)
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(db)
    return db
  }
  const db = await openDb('memory://')
  await migrate(db)
  return db
}

let seq = 0
export async function seedTenant(db, { type = 'points', status = 'active' } = {}) {
  seq += 1
  const {
    rows: [tenant],
  } = await db.query('INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id', [`T${seq}`, `t-${seq}-${Date.now()}`])
  const {
    rows: [program],
  } = await db.query('INSERT INTO programs (tenant_id, name, type, status) VALUES ($1, $2, $3, $4) RETURNING id', [tenant.id, 'Program', type, status])
  const {
    rows: [member],
  } = await db.query('INSERT INTO members (tenant_id, phone) VALUES ($1, $2) RETURNING id', [tenant.id, `+9665${String(10_000_000 + seq).slice(-8)}`])
  return { tenantId: tenant.id, programId: program.id, memberId: member.id }
}
