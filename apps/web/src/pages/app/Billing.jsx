import { Badge, Button, Card, Skeleton } from '@mirqam/ui'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { dateTime, money } from '../../lib/format.js'

const TONE = { active: 'green', expiring: 'amber', expired: 'red', trial: 'blue', none: 'gray' }

/* Only ever leave the console for the payment page we expect. */
function safeCheckout(url, host) {
  const u = new URL(url)
  const allowed = host ? u.hostname === host : u.hostname === 'checkout.moyasar.com'
  if (u.protocol !== 'https:' || !allowed) throw new Error('invalid_checkout')
  return u.href
}

/* Subscription state, plans (subscribe / renew / switch), auto-renewal, card, invoices and history. */
export default function Billing() {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const { data, loading, error, reload } = useApi('/billing')
  const state = useApi('/billing/state')
  const events = useApi('/billing/events')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const [result, setResult] = useState(null)
  const [coupon, setCoupon] = useState('')
  const [quote, setQuote] = useState(null)
  const [autoRenew, setAutoRenew] = useState(false)
  const params = new URLSearchParams(window.location.search)
  const checkout = params.get('checkout') || (params.get('billing') === 'paid' ? params.get('session') || 'latest' : null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: confirm once per returned checkout id.
  useEffect(() => {
    if (!checkout) return undefined
    let active = true
    api(`/billing/checkout/${encodeURIComponent(checkout)}/confirm`, { method: 'POST' })
      .then((r) => {
        if (active) {
          setResult(r.status)
          reload()
          state.reload()
          events.reload()
        }
      })
      .catch((e) => {
        if (active) setFailure(e)
      })
    return () => {
      active = false
    }
  }, [checkout])

  const refresh = () => {
    reload()
    state.reload()
    events.reload()
  }

  async function run(fn) {
    setBusy(true)
    setFailure(null)
    try {
      await fn()
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(false)
    }
  }

  async function subscribe(cycle) {
    setBusy(true)
    setFailure(null)
    try {
      const r = await api('/billing/checkout', { method: 'POST', body: { cycle, coupon: coupon.trim() || undefined, autoRenew }, idempotencyKey: crypto.randomUUID() })
      if (!r.url) {
        setResult(r.status)
        refresh()
        setBusy(false)
        return
      }
      window.location.assign(safeCheckout(r.url, data?.checkoutHost))
    } catch (e) {
      setFailure(e)
      setBusy(false)
    }
  }

  const checkCoupon = (cycle) =>
    run(async () => {
      setQuote(null)
      setQuote(await api('/billing/coupon', { method: 'POST', body: { cycle, coupon: coupon.trim() } }))
    })

  const updateCard = () =>
    run(async () => {
      const r = await api('/billing/payment-method', { method: 'POST', body: {} })
      if (r.url) window.location.assign(safeCheckout(r.url, data?.checkoutHost))
    })

  const post = (path, body = {}) =>
    run(async () => {
      await api(path, { method: 'POST', body })
      refresh()
    })

  const s = state.data
  const current = data?.subscription
  const remote = Boolean(data?.remote)
  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.vat')} />
      {(failure || error) && (
        <p role="alert" className="mb-4 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure || error)}
        </p>
      )}
      {result && (
        <p role="status" className="mb-4 rounded-xl border border-line bg-soft px-4 py-3 text-sm">
          {t(result === 'paid' ? 'billing.paid' : 'billing.pending')}
        </p>
      )}
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        data && (
          <div className="grid gap-6">
            <Card
              title={t(current?.active ? 'billing.active' : 'billing.inactive')}
              action={s && <Badge tone={TONE[s.state]}>{t(`billing.state.${s.state}`)}</Badge>}
            >
              {current?.expires_at && (
                <p>
                  {t('billing.until')} <span className="tnum font-semibold">{dateTime(current.expires_at, locale)}</span>
                  {s?.state !== 'expired' && s?.daysLeft > 0 && <span className="text-muted"> · {t('billing.daysLeft', { n: s.daysLeft })}</span>}
                </p>
              )}
              {s?.state === 'trial' && <p>{t('billing.trialLeft', { n: s.daysLeft })}</p>}
              {remote && current?.status === 'past_due' && <p className="mt-2 text-err">{t('billing.pastDue')}</p>}
              {remote && current?.active && (
                <div className="mt-4 grid gap-3">
                  <p className="text-sm">
                    {t(current.auto_renew ? 'billing.autoRenewOn' : 'billing.autoRenewOff')}
                    {current.payment_method && (
                      <span className="text-muted">
                        {' '}
                        · {t('billing.card', { brand: current.payment_method.brand || '', last4: current.payment_method.last4 || '' })}
                      </span>
                    )}
                  </p>
                  {current.cancel_at_period_end && <p className="text-sm text-err">{t('billing.endsAtPeriodEnd')}</p>}
                  <div className="flex flex-wrap gap-2">
                    {current.payment_method && (
                      <Button variant="outline" disabled={busy} onClick={() => post('/billing/auto-renew', { enabled: !current.auto_renew })}>
                        {t(current.auto_renew ? 'billing.turnOffAutoRenew' : 'billing.turnOnAutoRenew')}
                      </Button>
                    )}
                    <Button variant="outline" disabled={busy} onClick={updateCard}>
                      {t(current.payment_method ? 'billing.updateCard' : 'billing.addCard')}
                    </Button>
                    {current.cancel_at_period_end ? (
                      <Button variant="outline" disabled={busy} onClick={() => post('/billing/resume')}>
                        {t('billing.resume')}
                      </Button>
                    ) : (
                      <Button variant="outline" disabled={busy} onClick={() => window.confirm(t('billing.cancelConfirm')) && post('/billing/cancel')}>
                        {t('billing.cancel')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {!data.ready && <p className="text-err">{t('errors.billing_unavailable')}</p>}
            </Card>

            <div>
              <h2 className="mb-3 text-[17px] font-bold">{t('billing.plans')}</h2>
              {remote && (
                <Card className="mb-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="grid gap-1 text-sm">
                      {t('billing.coupon')}
                      <input
                        className="rounded-lg border border-line bg-surface px-3 py-2 uppercase"
                        value={coupon}
                        maxLength={40}
                        onChange={(e) => {
                          setCoupon(e.target.value)
                          setQuote(null)
                        }}
                      />
                    </label>
                    <Button variant="outline" disabled={busy || !coupon.trim()} onClick={() => checkCoupon(current?.cycle || 'monthly')}>
                      {t('billing.applyCoupon')}
                    </Button>
                  </div>
                  {quote && <p className="mt-2 text-sm text-ok">{t('billing.couponOk', { amount: money(quote.discount_minor, locale) })}</p>}
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="mt-1" />
                    <span>{t('billing.autoRenewConsent')}</span>
                  </label>
                </Card>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {['monthly', 'yearly'].map((cycle) => {
                  const mine = current?.active && current.cycle === cycle
                  const label = mine ? 'billing.renew' : current?.active ? 'billing.switchPlan' : 'billing.subscribe'
                  return (
                    <Card key={cycle} title={t(`billing.${cycle}`)} action={mine && <Badge tone="teal">{t('billing.currentPlan')}</Badge>}>
                      <p className="mb-1 text-2xl font-bold tnum">{data.prices[cycle] != null ? money(data.prices[cycle], locale) : '—'}</p>
                      <p className="mb-4 text-xs text-muted">{t(cycle === 'monthly' ? 'billing.perMonth' : 'billing.perYear')}</p>
                      <Button disabled={busy || !data.ready || data.prices[cycle] == null} loading={busy} onClick={() => subscribe(cycle)}>
                        {t(label)}
                      </Button>
                    </Card>
                  )
                })}
              </div>
            </div>

            {remote && (
              <Card title={t('billing.invoices')} bodyClass="">
                {data.invoices?.length ? (
                  <ul className="divide-y divide-line">
                    {data.invoices.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                        <div>
                          <p className="font-semibold tnum">{i.number}</p>
                          <p className="text-xs text-muted">
                            {dateTime(i.createdAt, locale)} · {money(i.totalMinor, locale)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {i.payUrl && (
                            <a className="text-accent underline" href={i.payUrl}>
                              {t('billing.payNow')}
                            </a>
                          )}
                          {i.receiptUrl && (
                            <a className="text-accent underline" href={i.receiptUrl} target="_blank" rel="noopener noreferrer">
                              {t('billing.receipt')}
                            </a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-6 py-5 text-sm text-muted">{t('billing.invoicesEmpty')}</p>
                )}
              </Card>
            )}

            <Card title={t('billing.history')} bodyClass="">
              {events.data?.items.length ? (
                <ul className="divide-y divide-line">
                  {events.data.items.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                      <div>
                        <p className="font-semibold">{t(`billing.event.${e.kind}`)}</p>
                        <p className="text-xs text-muted">
                          {dateTime(e.createdAt, locale)}
                          {e.data?.amountMinor ? ` · ${money(e.data.amountMinor, locale)}` : ''}
                        </p>
                      </div>
                      {e.emailStatus !== 'skipped' && (
                        <Badge tone={e.emailStatus === 'sent' ? 'green' : e.emailStatus === 'failed' ? 'red' : 'gray'}>
                          {t(e.emailStatus === 'sent' ? 'billing.emailSent' : e.emailStatus === 'failed' ? 'billing.emailFailed' : 'billing.emailPending')}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-6 py-5 text-sm text-muted">{t('billing.historyEmpty')}</p>
              )}
            </Card>
          </div>
        )
      )}
    </>
  )
}
