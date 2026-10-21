/* Mirqam unified billing client. When BILLING_URL is set, subscriptions, saved
   cards, auto-renewal, retries, coupons and billing emails live in
   mirqam-billing; this module keeps the same interface as billing.js so routes,
   the paywall gate and the console page work unchanged. The local
   `subscriptions` row is a cache of the entitlement pushed by billing
   (signed webhook) and re-read on demand, so a billing outage never locks a
   workspace out. */
import { createHmac, timingSafeEqual } from 'node:crypto'

const PLAN = 'loyalty'
const DAY = 86_400_000
const REMINDER_DAYS = 7
const LIVE = new Set(['trialing', 'active', 'past_due'])

export function createRemoteBilling({ db, config, HttpError, fetcher = fetch }) {
  const base = String(config.billingUrl || '').replace(/\/$/, '')
  const key = config.billingApiKey || ''
  const ready = Boolean(base && /^[a-f0-9]{64}$/.test(key))
  let catalogCache = null

  async function call(method, path, body, idempotencyKey) {
    if (!ready) throw new HttpError(503, 'billing_unavailable')
    let res
    try {
      res = await fetcher(`${base}/v1/${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new HttpError(502, 'billing_provider_error')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status >= 500) throw new HttpError(502, 'billing_provider_error')
      throw new HttpError(
        res.status === 404 ? 404 : res.status === 409 ? 409 : 400,
        data.error || 'billing_rejected',
        data.message ? { message: data.message } : undefined,
      )
    }
    return data
  }

  async function account(tenantId) {
    const t = (await db.query('SELECT id, name, billing_phone FROM tenants WHERE id=$1', [tenantId])).rows[0]
    if (!t) throw new HttpError(404, 'not_found')
    const owner = (
      await db.query(
        "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id=$1 AND m.role='owner' ORDER BY m.created_at LIMIT 1",
        [tenantId],
      )
    ).rows[0]
    // The phone is where billing sends WhatsApp reminders (pay links); owners set it in Settings.
    return { ref: tenantId, name: t.name, email: owner?.email || undefined, phone: t.billing_phone || undefined }
  }

  async function recordEvent(q, tenantId, kind, ref, data) {
    // Billing sends the emails; the local row is the in-app history feed only.
    await q.query(
      "INSERT INTO subscription_events(tenant_id,kind,ref,data,email_status) VALUES($1,$2,$3,$4,'skipped') ON CONFLICT (tenant_id,kind,ref) DO NOTHING",
      [tenantId, kind, String(ref).slice(0, 200), JSON.stringify(data)],
    )
  }

  /* Applies an entitlement to the local cache. Older versions never overwrite newer ones. */
  async function apply(ent) {
    if (!ent || ent.platform !== PLAN || typeof ent.account_ref !== 'string') return false
    const tenantId = ent.account_ref
    if (!(await db.query('SELECT 1 FROM tenants WHERE id=$1', [tenantId])).rows[0]) return false
    if (ent.status === 'none') return false
    return db.tx(async (tx) => {
      await tx.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [tenantId])
      const prior = (await tx.query('SELECT * FROM subscriptions WHERE tenant_id=$1', [tenantId])).rows[0]
      if (prior && Number(prior.billing_version || 0) > Number(ent.version || 0)) return false
      const allowed = LIVE.has(ent.status)
      const until = allowed ? new Date(ent.active_until) : new Date(Math.min(Date.now(), new Date(ent.active_until || Date.now()).getTime()))
      await tx.query(
        `INSERT INTO subscriptions(tenant_id,cycle,expires_at,status,plan,auto_renew,cancel_at_period_end,payment_method,period_end,billing_version,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT(tenant_id) DO UPDATE SET cycle=EXCLUDED.cycle, expires_at=EXCLUDED.expires_at, status=EXCLUDED.status, plan=EXCLUDED.plan,
           auto_renew=EXCLUDED.auto_renew, cancel_at_period_end=EXCLUDED.cancel_at_period_end, payment_method=EXCLUDED.payment_method,
           period_end=EXCLUDED.period_end, billing_version=EXCLUDED.billing_version, updated_at=now()`,
        [
          tenantId,
          ent.cycle === 'yearly' ? 'yearly' : 'monthly',
          until,
          ent.status,
          ent.plan,
          Boolean(ent.auto_renew),
          Boolean(ent.cancel_at_period_end),
          ent.payment_method ? JSON.stringify(ent.payment_method) : null,
          ent.current_period_end ? new Date(ent.current_period_end) : until,
          Number(ent.version || 0),
        ],
      )
      // In-app history, derived from state changes.
      const periodEnd = ent.current_period_end || ent.active_until
      const wasLive = prior ? LIVE.has(prior.status || 'active') : false
      if (ent.status === 'active') {
        if (!prior || !wasLive) await recordEvent(tx, tenantId, 'activated', `active:${periodEnd}`, { cycle: ent.cycle, expiresAt: periodEnd })
        else if (prior.cycle !== ent.cycle)
          await recordEvent(tx, tenantId, 'plan_changed', `cycle:${ent.cycle}:${periodEnd}`, { cycle: ent.cycle, expiresAt: periodEnd })
        else if (prior.period_end && new Date(periodEnd) > new Date(prior.period_end))
          await recordEvent(tx, tenantId, 'renewed', `active:${periodEnd}`, { cycle: ent.cycle, expiresAt: periodEnd })
      } else if (ent.status === 'past_due' && prior?.status !== 'past_due') {
        await recordEvent(tx, tenantId, 'payment_failed', `past_due:${periodEnd}`, { cycle: ent.cycle, graceUntil: ent.active_until })
      } else if (['suspended', 'expired', 'canceled'].includes(ent.status) && wasLive) {
        await recordEvent(tx, tenantId, 'expired', `${ent.status}:${periodEnd}`, { cycle: ent.cycle, expiresAt: periodEnd })
      }
      return true
    })
  }

  async function sync(tenantId) {
    const ent = await call('GET', `entitlements/${encodeURIComponent(tenantId)}`)
    await apply(ent)
    return ent
  }

  /* Signed `entitlement.updated` from billing: t=<unix>,v1=hmac(secret, t.body). */
  async function hook(rawBody, signature) {
    const secret = config.billingWebhookSecret || ''
    const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(String(signature || ''))
    if (!secret || !m) throw new HttpError(401, 'unauthenticated')
    if (Math.abs(Date.now() / 1000 - Number(m[1])) > 600) throw new HttpError(401, 'unauthenticated')
    const expected = createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest('hex')
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(m[2], 'hex'))) throw new HttpError(401, 'unauthenticated')
    let event
    try {
      event = JSON.parse(rawBody)
    } catch {
      throw new HttpError(400, 'validation_failed')
    }
    if (event?.type === 'entitlement.updated') await apply(event.data)
  }

  async function catalog() {
    if (catalogCache && catalogCache.at > Date.now() - 300_000) return catalogCache.prices
    const c = await call('GET', 'catalog')
    const prices = {}
    for (const p of c.plans) if (p.code === PLAN && p.kind === 'plan') prices[p.cycle] = p.amount_minor
    catalogCache = { at: Date.now(), prices }
    return prices
  }

  async function entitlement(tenantId, now = new Date()) {
    const sub = (await db.query('SELECT cycle, expires_at, status FROM subscriptions WHERE tenant_id=$1', [tenantId])).rows[0]
    if (sub) {
      const left = sub.expires_at.getTime() - now.getTime()
      if (left <= 0) return { state: 'expired', allowed: false, expiresAt: sub.expires_at, cycle: sub.cycle, daysLeft: 0 }
      const daysLeft = Math.ceil(left / DAY)
      const state = sub.status === 'past_due' || daysLeft <= REMINDER_DAYS ? 'expiring' : 'active'
      return { state, allowed: true, expiresAt: sub.expires_at, cycle: sub.cycle, daysLeft, billingStatus: sub.status }
    }
    const created = (await db.query('SELECT created_at FROM tenants WHERE id=$1', [tenantId])).rows[0]?.created_at
    const trialDays = Number.isFinite(config.trialDays) ? config.trialDays : 14
    const trialEndsAt = created ? new Date(new Date(created).getTime() + trialDays * DAY) : null
    if (trialEndsAt && trialEndsAt > now) return { state: 'trial', allowed: true, trialEndsAt, daysLeft: Math.ceil((trialEndsAt - now) / DAY) }
    return { state: 'none', allowed: false, trialEndsAt, daysLeft: 0 }
  }

  const gate = () => async (req, _res, next) => {
    try {
      if (!req.auth) return next()
      if (!config.billingEnforce && !(await db.query('SELECT 1 FROM pos_provisioned_accounts WHERE tenant_id=$1', [req.auth.tenantId])).rows.length)
        return next()
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
      if (/^\/(auth|billing|public)(\/|$)/.test(req.path)) return next()
      if ((await entitlement(req.auth.tenantId)).allowed) return next()
      next(new HttpError(402, 'subscription_required'))
    } catch (err) {
      next(err)
    }
  }

  return {
    ready,
    remote: true,
    checkoutHost: base ? new URL(base).hostname : null,
    apply,
    sync,
    /** Pushes the current owner contact (email, WhatsApp number) to billing right away. */
    async syncAccount(tenantId) {
      const acc = await account(tenantId)
      // Only this explicit save may clear the number in billing; ordinary calls never send null.
      return call('POST', 'accounts', { account: { ...acc, phone: acc.phone ?? null } })
    },
    hook,
    entitlement,
    gate,
    async checkout(tenantId, cycle, requestKey, opts = {}) {
      if (!['monthly', 'yearly'].includes(cycle)) throw new HttpError(400, 'validation_failed')
      const r = await call(
        'POST',
        'checkout-sessions',
        {
          account: await account(tenantId),
          plan: PLAN,
          cycle,
          coupon: opts.coupon || undefined,
          auto_renew: opts.autoRenew === true,
          referral: /^[a-f0-9]{32}$/.test(opts.referral || '') ? opts.referral : undefined,
          return_url: `${opts.returnBase || config.publicUrl}/app/billing`,
        },
        requestKey ? `loyalty-${tenantId}-${requestKey}`.slice(0, 120) : undefined,
      )
      if (r.done || r.completed) await sync(tenantId).catch(() => {})
      return {
        id: r.id || null,
        checkout_url: r.done || r.completed ? null : r.url,
        status: r.done || r.completed ? 'paid' : 'pending',
        scheduled: Boolean(r.scheduled),
        amountMinor: r.amount_minor ?? null,
      }
    },
    async confirm(tenantId) {
      const ent = await sync(tenantId)
      return { status: ent.allowed && ent.status === 'active' ? 'paid' : 'pending' }
    },
    async validateCoupon(tenantId, cycle, code) {
      return call('POST', 'coupons/validate', { account: await account(tenantId), plan: PLAN, cycle, coupon: code })
    },
    async cancel(tenantId) {
      const e = await call('POST', `subscriptions/${encodeURIComponent(tenantId)}/cancel`, {})
      await apply(e)
      return e
    },
    async resume(tenantId) {
      const e = await call('POST', `subscriptions/${encodeURIComponent(tenantId)}/resume`, {})
      await apply(e)
      return e
    },
    async autoRenew(tenantId, enabled) {
      const e = await call('POST', `subscriptions/${encodeURIComponent(tenantId)}/auto-renew`, { enabled: Boolean(enabled) })
      await apply(e)
      return e
    },
    async paymentMethod(tenantId, base) {
      return call('POST', `subscriptions/${encodeURIComponent(tenantId)}/payment-method`, { return_url: `${base || config.publicUrl}/app/billing` })
    },
    /* Reconciles cached entitlements with billing (missed webhooks, clock edges). Billing does all reminders and emails. */
    async runLifecycle(now = new Date()) {
      const due = (
        await db.query("SELECT tenant_id FROM subscriptions WHERE updated_at < $1 OR expires_at < $2 OR status IN ('past_due') ORDER BY updated_at LIMIT 200", [
          new Date(now.getTime() - 6 * 3_600_000),
          new Date(now.getTime() + DAY),
        ])
      ).rows
      let synced = 0
      for (const { tenant_id } of due) {
        try {
          await sync(tenant_id)
          synced += 1
        } catch {}
      }
      return { reminded: 0, expired: 0, emailed: 0, synced }
    },
    async flushEmails() {
      return 0
    },
    async events(tenantId) {
      return (
        await db.query('SELECT id, kind, data, email_status, created_at FROM subscription_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [
          tenantId,
        ])
      ).rows
    },
    async state(tenantId) {
      const e = await entitlement(tenantId)
      return {
        state: e.state,
        daysLeft: e.daysLeft,
        expiresAt: e.expiresAt ?? null,
        trialEndsAt: e.trialEndsAt ?? null,
        enforced: Boolean(config.billingEnforce),
      }
    },
    async status(tenantId) {
      let portal = null,
        prices = {}
      try {
        prices = await catalog()
      } catch {}
      try {
        portal = await call('GET', `portal/${encodeURIComponent(tenantId)}`)
        await apply(portal.entitlement)
      } catch {}
      const sub =
        (
          await db.query(
            'SELECT cycle,expires_at,expires_at>now() AS active,status,auto_renew,cancel_at_period_end,payment_method,period_end FROM subscriptions WHERE tenant_id=$1',
            [tenantId],
          )
        ).rows[0] || null
      return {
        ready,
        remote: true,
        checkoutHost: base ? new URL(base).hostname : null,
        prices,
        currency: 'SAR',
        vatIncluded: true,
        subscription: sub,
        invoices: (portal?.invoices || []).map((i) => ({
          id: i.id,
          number: i.number,
          totalMinor: i.total_minor,
          status: i.status,
          createdAt: i.created_at,
          payUrl: i.pay_url,
          receiptUrl: i.receipt_url,
        })),
      }
    },
    async webhook() {
      // Payments now go through mirqam-billing; the old Moyasar invoice webhook is a no-op.
    },
  }
}
