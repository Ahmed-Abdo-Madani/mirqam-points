/* Gift cards: stored value in integer halalas, append-only entries, the same
   idempotency + row-locking contract as the points ledger.
   The 16-character code is a bearer secret. Only its SHA-256 is searchable;
   a sealed (AES-GCM) copy lets the recipient's card page and wallet pass show it. */
import crypto from 'node:crypto'
import { int, UNIQUE_VIOLATION } from './db/index.js'
import { LedgerError } from './ledger.js'
import { normalizeCode, randomCode, randomToken, seal, sha256, unseal } from './secrets.js'

export const formatGiftCode = (code) => code.match(/.{1,4}/g).join('-')

export function mapCard(row) {
  return {
    id: row.id,
    last4: row.code_last4,
    initialMinor: int(row.initial_minor),
    balanceMinor: int(row.balance_minor),
    status: row.status,
    expired: Boolean(row.expires_at && new Date(row.expires_at) < new Date()),
    expiresAt: row.expires_at,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    senderName: row.sender_name,
    message: row.message,
    publicToken: row.public_token,
    createdAt: row.created_at,
  }
}

export function mapGiftEntry(row) {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: int(row.amount_minor),
    balanceAfter: int(row.balance_after),
    ref: row.ref,
    note: row.note,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }
}

const hashRequest = (parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex')

async function entryByKey(q, tenantId, key) {
  const { rows } = await q.query('SELECT * FROM gift_card_entries WHERE tenant_id = $1 AND idempotency_key = $2', [tenantId, key])
  return rows[0] || null
}

/** Issues a card with its opening balance. Returns { card, code }; a replay returns the same card and code. */
export async function issue(db, input, secretKey) {
  const { tenantId, amountMinor, expiresAt = null, recipientName = null, recipientPhone = null, senderName = null, message = null, actorUserId = null } = input
  const requestHash = hashRequest(['issue', amountMinor, expiresAt, recipientName, recipientPhone, senderName, message])
  const prior = await entryByKey(db, tenantId, input.idempotencyKey)
  if (prior) return replayIssue(db, prior, requestHash, secretKey)
  if (!secretKey) throw new LedgerError('gift_cards_unavailable', 503)
  const code = randomCode(16)
  try {
    return await db.tx(async (tx) => {
      const {
        rows: [card],
      } = await tx.query(
        `INSERT INTO gift_cards (tenant_id, code_hash, code_last4, code_sealed, public_token, initial_minor, balance_minor,
                                 expires_at, recipient_name, recipient_phone, sender_name, message, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          tenantId,
          sha256(code),
          code.slice(-4),
          seal(code, secretKey),
          randomToken(24),
          amountMinor,
          expiresAt,
          recipientName,
          recipientPhone,
          senderName,
          message,
          actorUserId,
        ],
      )
      await tx.query(
        `INSERT INTO gift_card_entries (tenant_id, gift_card_id, kind, amount_minor, balance_after, actor_user_id, idempotency_key, request_hash)
         VALUES ($1, $2, 'issue', $3, $3, $4, $5, $6)`,
        [tenantId, card.id, amountMinor, actorUserId, input.idempotencyKey, requestHash],
      )
      return { card: mapCard(card), code: formatGiftCode(code), replayed: false }
    })
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      const winner = await entryByKey(db, tenantId, input.idempotencyKey)
      if (winner) return replayIssue(db, winner, requestHash, secretKey)
    }
    throw err
  }
}

async function replayIssue(db, entry, requestHash, secretKey) {
  if (entry.request_hash !== requestHash || entry.kind !== 'issue') throw new LedgerError('idempotency_mismatch', 409)
  const { rows } = await db.query('SELECT * FROM gift_cards WHERE id = $1', [entry.gift_card_id])
  return { card: mapCard(rows[0]), code: formatGiftCode(unseal(rows[0].code_sealed, secretKey)), replayed: true }
}

export async function findByCode(db, tenantId, code) {
  const normalized = normalizeCode(code)
  if (!/^[0-9A-Z]{16}$/.test(normalized)) return null
  const { rows } = await db.query('SELECT * FROM gift_cards WHERE tenant_id = $1 AND code_hash = $2', [tenantId, sha256(normalized)])
  return rows[0] || null
}

/* Shared write path for redeem / void. `plan(card)` returns { kind, amount } or throws. */
async function write(db, { tenantId, cardId, idempotencyKey, requestParts, meta, plan }) {
  const requestHash = hashRequest(requestParts)
  const replay = async (q, entry) => {
    if (entry.request_hash !== requestHash) throw new LedgerError('idempotency_mismatch', 409)
    const { rows } = await q.query('SELECT * FROM gift_cards WHERE id = $1', [entry.gift_card_id])
    return { entry: mapGiftEntry(entry), card: mapCard(rows[0]), replayed: true }
  }
  const prior = await entryByKey(db, tenantId, idempotencyKey)
  if (prior) return replay(db, prior)
  try {
    return await db.tx(async (tx) => {
      const {
        rows: [card],
      } = await tx.query('SELECT * FROM gift_cards WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [cardId, tenantId])
      if (!card) throw new LedgerError('gift_card_not_found', 404)
      const raced = await entryByKey(tx, tenantId, idempotencyKey)
      if (raced) return replay(tx, raced)
      const step = plan(card)
      const balance = int(card.balance_minor) + step.amount
      if (balance < 0) throw new LedgerError('insufficient_balance', 422)
      const {
        rows: [entry],
      } = await tx.query(
        `INSERT INTO gift_card_entries (tenant_id, gift_card_id, kind, amount_minor, balance_after, ref, note, actor_user_id, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [tenantId, cardId, step.kind, step.amount, balance, meta.ref ?? null, meta.note ?? null, meta.actorUserId ?? null, idempotencyKey, requestHash],
      )
      const {
        rows: [updated],
      } = await tx.query('UPDATE gift_cards SET balance_minor = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *', [
        cardId,
        balance,
        step.status ?? card.status,
      ])
      return { entry: mapGiftEntry(entry), card: mapCard(updated), replayed: false }
    })
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      const winner = await entryByKey(db, tenantId, idempotencyKey)
      if (winner) return replay(db, winner)
    }
    throw err
  }
}

/** Spends `amountMinor` from an active, unexpired card. Partial redemption is the norm. */
export function redeem(db, { tenantId, cardId, amountMinor, idempotencyKey, ...meta }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new LedgerError('invalid_amount', 400)
  return write(db, {
    tenantId,
    cardId,
    idempotencyKey,
    meta,
    requestParts: ['redeem', cardId, amountMinor, meta.ref ?? null],
    plan: (card) => {
      if (card.status !== 'active') throw new LedgerError(card.status === 'frozen' ? 'gift_card_frozen' : 'gift_card_voided', 422)
      if (card.expires_at && new Date(card.expires_at) < new Date()) throw new LedgerError('gift_card_expired', 422)
      return { kind: 'redeem', amount: -amountMinor }
    },
  })
}

/** Cancels a card permanently; any remaining balance is written off with a void entry. */
export function voidCard(db, { tenantId, cardId, idempotencyKey, ...meta }) {
  return write(db, {
    tenantId,
    cardId,
    idempotencyKey,
    meta,
    requestParts: ['void', cardId],
    plan: (card) => {
      if (card.status === 'voided') throw new LedgerError('gift_card_voided', 409)
      const balance = int(card.balance_minor)
      // A zero-balance card has nothing to reverse; a nominal entry would violate amount <> 0.
      if (balance === 0) throw new LedgerError('nothing_to_void', 422)
      return { kind: 'void', amount: -balance, status: 'voided' }
    },
  })
}
