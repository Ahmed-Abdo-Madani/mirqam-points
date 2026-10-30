/* Migration 016 on a database that already holds data from earlier releases:
   workspaces an owner's deletion only closed become due for the purge, and
   logins that removed staff left behind are erased. */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runPurges } from './account-deletion.js'
import { openDb } from './db/index.js'
import { migrate } from './db/migrate.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../migrations')
let db
beforeAll(async () => {
  db = await openDb('memory://')
  await db.exec('CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  for (const file of readdirSync(DIR)
    .filter((f) => /^\d{3}-[\w-]+\.sql$/.test(f) && f < '016')
    .sort()) {
    await db.exec(readFileSync(join(DIR, file), 'utf8'))
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
  }
})
afterAll(() => db.close())

const one = async (sql, params) => (await db.query(sql, params)).rows[0]

it('schedules closed workspaces for the purge and erases logins without a workspace', async () => {
  const open = await one("INSERT INTO tenants (name, slug) VALUES ('Open', 'open-store') RETURNING id")
  const closed = await one("INSERT INTO tenants (name, slug, closed_at) VALUES ('Closed', 'closed-store', now()) RETURNING id")
  const user = (email) => one("INSERT INTO users (email, password_hash, name) VALUES ($1, 'scrypt$x$y', 'Person') RETURNING id", [email])
  const owner = await user('owner@example.test')
  const idle = await user('removed-idle@example.test')
  const busy = await user('removed-busy@example.test')
  const leftover = await user('staff-of-closed@example.test')
  await db.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'cashier')", [
    open.id,
    owner.id,
    closed.id,
    leftover.id,
  ])
  await db.query("INSERT INTO social_identities (provider, subject, user_id) VALUES ('google', 'idle-sub', $1)", [idle.id])
  const program = await one("INSERT INTO programs (tenant_id, name, type, status) VALUES ($1, 'P', 'points', 'active') RETURNING id", [open.id])
  const member = await one("INSERT INTO members (tenant_id, phone) VALUES ($1, '+966501234567') RETURNING id", [open.id])
  const account = await one('INSERT INTO accounts (tenant_id, program_id, member_id, balance, lifetime_earned) VALUES ($1, $2, $3, 5, 5) RETURNING id', [
    open.id,
    program.id,
    member.id,
  ])
  await db.query(
    "INSERT INTO ledger_entries (tenant_id, account_id, kind, amount, balance_after, actor_user_id, idempotency_key, request_hash) VALUES ($1, $2, 'earn', 5, 5, $3, 'legacy-key-1', 'h')",
    [open.id, account.id, busy.id],
  )

  await migrate(db)

  expect((await one('SELECT purge_after FROM tenants WHERE id = $1', [closed.id])).purge_after).toBeTruthy()
  expect((await one('SELECT purge_after FROM tenants WHERE id = $1', [open.id])).purge_after).toBeNull()
  expect(await one('SELECT id FROM users WHERE id = $1', [idle.id])).toBeUndefined()
  expect(await one('SELECT 1 AS n FROM social_identities WHERE user_id = $1', [idle.id])).toBeUndefined()
  // Still the actor of an entry in a live workspace: kept, anonymised.
  expect(await one('SELECT email, name, password_hash FROM users WHERE id = $1', [busy.id])).toEqual({
    email: `deleted-${busy.id}@deleted.invalid`,
    name: 'deleted',
    password_hash: 'deleted',
  })
  expect((await one('SELECT email FROM users WHERE id = $1', [owner.id])).email).toBe('owner@example.test')

  // The first sweep after deploy purges the closed workspace and its staff login.
  expect((await runPurges(db)).purged).toBe(1)
  expect(await one('SELECT id FROM tenants WHERE id = $1', [closed.id])).toBeUndefined()
  expect(await one('SELECT id FROM users WHERE id = $1', [leftover.id])).toBeUndefined()
  expect((await one('SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = $1', [open.id])).n).toBe(1)
})
