import { Badge, Button, Card, Skeleton } from '@mirqam/ui'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { dateTime, money } from '../../lib/format.js'

const TONE = { active: 'green', expiring: 'amber', expired: 'red', trial: 'blue', none: 'gray' }

/* Subscription state, plans (subscribe / renew / switch) and the lifecycle history. */
export default function Billing() {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const { data, loading, error, reload } = useApi('/billing')
  const state = useApi('/billing/state')
  const events = useApi('/billing/events')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const [result, setResult] = useState(null)
  const checkout = new URLSearchParams(window.location.search).get('checkout')

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

  async function subscribe(cycle) {
    setBusy(true)
    setFailure(null)
    try {
      const r = await api('/billing/checkout', { method: 'POST', body: { cycle }, idempotencyKey: crypto.randomUUID() })
      const url = new URL(r.url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.moyasar.com') throw new Error('invalid_checkout')
      window.location.assign(url.href)
    } catch (e) {
      setFailure(e)
      setBusy(false)
    }
  }

  const s = state.data
  const current = data?.subscription
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
              {!data.ready && <p className="text-err">{t('errors.billing_unavailable')}</p>}
            </Card>

            <div>
              <h2 className="mb-3 text-[17px] font-bold">{t('billing.plans')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {['monthly', 'yearly'].map((cycle) => {
                  const mine = current?.active && current.cycle === cycle
                  const label = mine ? 'billing.renew' : current?.active ? 'billing.switchPlan' : 'billing.subscribe'
                  return (
                    <Card key={cycle} title={t(`billing.${cycle}`)} action={mine && <Badge tone="teal">{t('billing.currentPlan')}</Badge>}>
                      <p className="mb-1 text-2xl font-bold tnum">{money(data.prices[cycle], locale)}</p>
                      <p className="mb-4 text-xs text-muted">{t(cycle === 'monthly' ? 'billing.perMonth' : 'billing.perYear')}</p>
                      <Button disabled={busy || !data.ready} loading={busy} onClick={() => subscribe(cycle)}>
                        {t(label)}
                      </Button>
                    </Card>
                  )
                })}
              </div>
            </div>

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
