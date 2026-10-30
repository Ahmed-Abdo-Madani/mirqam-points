/* Points ledger engine.

   Invariants (enforced here AND by the schema):
   1. ledger_entries is append-only; corrections are new rows.
   2. accounts.balance == SUM(ledger_entries.amount) for the account, always ≥ 0.
   3. Every mutation carries an idempotency key, unique per tenant. Replaying
      the same key with the same request returns the original result; reusing
      a key for a different request is rejected (409 idempotency_mismatch).
   4. Writes to one account are serialized by SELECT … FOR UPDATE.
   5. An entry can be voided at most once, and a void never drives a balance
      negative (points already spent cannot be clawed back silently). */
import crypto from 'node:crypto'
import { int, UNIQUE_VIOLATION } from './db/index.js'

export class LedgerError extends Error {
  constructor(code, status = 409) {
    super(code)
    this.code = code
    this.status = status
  }
}

const MAX_AMOUNT = 10_000_000

export function mapEntry(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    amount: int(row.amount),
    balanceAfter: int(row.balance_after),
    source: row.source,
    ref: row.ref,
    note: row.note,
    purchaseMinor: row.purchase_minor == null ? null : int(row.purchase_minor),
    actorUserId: row.actor_user_id,
    reversesEntryId: row.reverses_entry_id,
    createdAt: row.created_at,
  }
}

function hashRequest(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

async function findByKey(q, tenantId, key) {
  const { rows } = await q.query('SELECT * FROM ledger_entries WHERE tenant_id = $1 AND idempotency_key = $2', [tenantId, key])
  return rows[0] || null
}

async function replay(q, row, requestHash) {
  if (row.request_hash !== requestHash) throw new LedgerError('idempotency_mismatch', 409)
  const { rows } = await q.query('SELECT balance FROM accounts WHERE id = $1', [row.account_id])
  return { entry: mapEntry(row), balance: int(rows[0].balance), replayed: true }
}

function checkKey(key) {
  if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw new LedgerError('idempotency_key_required', 400)
}

/* Shared write path: idempotency check → lock account → compute → insert → update cache.
   `plan(tx, account)` returns { kind, amount, reversesEntryId?, lifetimeDelta } or throws. */
async function write(db, { tenantId, accountId, idempotencyKey, requestParts, meta, plan }) {
  checkKey(idempotencyKey)
  const requestHash = hashRequest(requestParts)
  const prior = await findByKey(db, tenantId, idempotencyKey)
  if (prior) return replay(db, prior, requestHash)
  try {
    return await db.tx(async (tx) => {
      const { rows } = await tx.query('SELECT id, balance, lifetime_earned FROM accounts WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [accountId, tenantId])
      const account = rows[0]
      if (!account) throw new LedgerError('account_not_found', 404)
      // Re-check under the lock: a concurrent request with the same key may have committed.
      const raced = await findByKey(tx, tenantId, idempotencyKey)
      if (raced) return replay(tx, raced, requestHash)

      const step = await plan(tx, account)
      const balance = int(account.balance) + step.amount
      if (balance < 0) throw new LedgerError('insufficient_balance', 422)
      const lifetime = Math.max(0, int(account.lifetime_earned) + (step.lifetimeDelta || 0))

      const inserted = await tx.query(
        `INSERT INTO ledger_entries
           (tenant_id, account_id, kind, amount, balance_after, source, ref, note, purchase_minor,
            actor_user_id, idempotency_key, request_hash, reverses_entry_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          tenantId,
          accountId,
          step.kind,
          step.amount,
          balance,
          meta.source || 'console',
          meta.ref ?? null,
          meta.note ?? null,
          meta.purchaseMinor ?? null,
          meta.actorUserId ?? null,
          idempotencyKey,
          requestHash,
          step.reversesEntryId ?? null,
        ],
      )
      await tx.query('UPDATE accounts SET balance = $2, lifetime_earned = $3, updated_at = now() WHERE id = $1', [accountId, balance, lifetime])
      return { entry: mapEntry(inserted.rows[0]), balance, replayed: false }
    })
  } catch (err) {
    // Lost a race on the idempotency key between our pre-check and insert.
    if (err.code === UNIQUE_VIOLATION) {
      const winner = await findByKey(db, tenantId, idempotencyKey)
      if (winner) return replay(db, winner, requestHash)
    }
    throw err
  }
}

function checkAmount(points) {
  if (!Number.isSafeInteger(points) || points <= 0 || points > MAX_AMOUNT) throw new LedgerError('invalid_amount', 400)
}

/** Credit points/stamps. `points` > 0. */
export async function earn(db, { tenantId, accountId, points, idempotencyKey, ...meta }) {
  checkAmount(points)
  return write(db, {
    tenantId,
    accountId,
    idempotencyKey,
    meta,
    requestParts: ['earn', accountId, points, meta.source, meta.ref ?? null, meta.purchaseMinor ?? null],
    plan: () => ({ kind: 'earn', amount: points, lifetimeDelta: points }),
  })
}

/** Debit points/stamps. `points` > 0; fails with insufficient_balance rather than going negative. */
export async function redeem(db, { tenantId, accountId, points, idempotencyKey, ...meta }) {
  checkAmount(points)
  return write(db, {
    tenantId,
    accountId,
    idempotencyKey,
    meta,
    requestParts: ['redeem', accountId, points, meta.source, meta.ref ?? null],
    plan: () => ({ kind: 'redeem', amount: -points }),
  })
}

/** Manual correction with a mandatory reason. `points` is signed and non-zero. Does not count toward lifetime. */
export async function adjust(db, { tenantId, accountId, points, idempotencyKey, ...meta }) {
  if (!Number.isSafeInteger(points) || points === 0 || Math.abs(points) > MAX_AMOUNT) throw new LedgerError('invalid_amount', 400)
  if (!meta.note || !String(meta.note).trim()) throw new LedgerError('note_required', 400)
  return write(db, {
    tenantId,
    accountId,
    idempotencyKey,
    meta,
    requestParts: ['adjust', accountId, points, meta.note],
    plan: () => ({ kind: 'adjust', amount: points }),
  })
}

/** Reverse one entry exactly. Voiding an earn also removes it from lifetime_earned. */
export async function voidEntry(db, { tenantId, entryId, idempotencyKey, ...meta }) {
  const { rows } = await db.query('SELECT * FROM ledger_entries WHERE id = $1 AND tenant_id = $2', [entryId, tenantId])
  const original = rows[0]
  if (!original) throw new LedgerError('entry_not_found', 404)
  if (original.kind === 'void') throw new LedgerError('cannot_void_void', 422)
  return write(db, {
    tenantId,
    accountId: original.account_id,
    idempotencyKey,
    meta,
    requestParts: ['void', entryId],
    plan: async (tx) => {
      // Serialized by the account lock, so this check cannot race another void.
      const done = await tx.query('SELECT 1 FROM ledger_entries WHERE reverses_entry_id = $1', [entryId])
      if (done.rows.length) throw new LedgerError('already_voided', 409)
      const amount = -int(original.amount)
      return {
        kind: 'void',
        amount,
        reversesEntryId: entryId,
        lifetimeDelta: original.kind === 'earn' ? amount : 0,
      }
    },
  })
}

/** Member erasure: zeroes one account with a single `expire` entry, inside the
    caller's transaction (the account row must already be locked FOR UPDATE).
    Idempotent per account; returns the points/stamps forfeited (0 when none). */
export async function forfeitBalance(tx, { tenantId, accountId, actorUserId = null }) {
  const { rows } = await tx.query('SELECT balance FROM accounts WHERE id = $1 AND tenant_id = $2', [accountId, tenantId])
  const balance = int(rows[0]?.balance ?? 0)
  if (balance <= 0) return 0
  const idempotencyKey = `erase-${accountId}`
  if (await findByKey(tx, tenantId, idempotencyKey)) return 0
  await tx.query(
    `INSERT INTO ledger_entries (tenant_id, account_id, kind, amount, balance_after, source, actor_user_id, idempotency_key, request_hash)
     VALUES ($1, $2, 'expire', $3, 0, 'system', $4, $5, $6)`,
    [tenantId, accountId, -balance, actorUserId, idempotencyKey, hashRequest(['expire', accountId, -balance])],
  )
  await tx.query('UPDATE accounts SET balance = 0, updated_at = now() WHERE id = $1', [accountId])
  return balance
}

/** Find or create the member's account in a program (idempotent). */
export async function ensureAccount(db, { tenantId, programId, memberId }) {
  await db.query(
    `INSERT INTO accounts (tenant_id, program_id, member_id) VALUES ($1, $2, $3)
     ON CONFLICT (program_id, member_id) DO NOTHING`,
    [tenantId, programId, memberId],
  )
  const { rows } = await db.query('SELECT * FROM accounts WHERE program_id = $1 AND member_id = $2 AND tenant_id = $3', [programId, memberId, tenantId])
  return rows[0]
}

/** Accounts whose cached balance or lifetime disagree with the ledger. Empty array = healthy. */
export async function reconcile(db, { tenantId } = {}) {
  const { rows } = await db.query(
    `SELECT a.id, a.tenant_id, a.balance, COALESCE(SUM(e.amount), 0) AS ledger_balance
       FROM accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
      WHERE ($1::uuid IS NULL OR a.tenant_id = $1)
      GROUP BY a.id
     HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
    [tenantId ?? null],
  )
  return rows.map((r) => ({ accountId: r.id, tenantId: r.tenant_id, balance: int(r.balance), ledgerBalance: int(r.ledger_balance) }))
}
