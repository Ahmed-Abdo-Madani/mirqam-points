import { Button, Card, Input, Skeleton } from '@mirqam/ui'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
export default function Billing() {
  const { t } = useI18n(),
    errorText = useErrorText()
  const { data, loading, error, reload } = useApi('/billing')
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(null),
    [result, setResult] = useState(null)
  const [coupon, setCoupon] = useState(''),
    [applied, setApplied] = useState(''),
    [quotes, setQuotes] = useState(null)
  const checkout = new URLSearchParams(window.location.search).get('checkout')
  useEffect(() => {
    if (!checkout) return
    let active = true
    api(`/billing/checkout/${encodeURIComponent(checkout)}/confirm`, { method: 'POST' })
      .then((r) => {
        if (active) {
          setResult(r.status)
          reload()
        }
      })
      .catch((e) => {
        if (active) setFailure(e)
      })
    return () => {
      active = false
    }
  }, [checkout, reload])
  async function applyCoupon() {
    const code = coupon.trim().toUpperCase()
    setBusy(true)
    setFailure(null)
    setQuotes(null)
    setApplied('')
    try {
      const pairs = await Promise.all(
        ['monthly', 'yearly'].map(async (cycle) => [cycle, await api('/billing/quote', { method: 'POST', body: { cycle, coupon: code } })]),
      )
      setQuotes(Object.fromEntries(pairs))
      setApplied(code)
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
      const r = await api('/billing/checkout', { method: 'POST', body: { cycle, coupon: coupon.trim().toUpperCase() }, idempotencyKey: crypto.randomUUID() })
      const url = new URL(r.url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.moyasar.com') throw new Error('invalid_checkout')
      window.location.assign(url.href)
    } catch (e) {
      setFailure(e)
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.vat')} />
      {(failure || error) && (
        <p role="alert" className="mb-4 text-err">
          {errorText(failure || error)}
        </p>
      )}
      {result && (
        <p role="status" className="mb-4">
          {t(result === 'paid' ? 'billing.paid' : 'billing.pending')}
        </p>
      )}
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        data && (
          <>
            <Card title={t(data.subscription?.active ? 'billing.active' : 'billing.inactive')}>
              {data.subscription?.expires_at && (
                <p>
                  {t('billing.until')} {new Date(data.subscription.expires_at).toLocaleDateString()}
                </p>
              )}
              {!data.ready && <p>{t('errors.billing_unavailable')}</p>}
            </Card>
            {data.commerceEnabled && (
              <Card title={t('billing.coupon')} className="mt-6">
                <Input
                  aria-label={t('billing.coupon')}
                  value={coupon}
                  maxLength={40}
                  disabled={busy}
                  onChange={(e) => {
                    setCoupon(e.target.value)
                    setQuotes(null)
                    setApplied('')
                  }}
                />
                <Button disabled={busy || !coupon.trim()} onClick={applyCoupon}>
                  {t('billing.applyCoupon')}
                </Button>
                {quotes && <p role="status">{t('billing.couponApplied')}</p>}
              </Card>
            )}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {['monthly', 'yearly'].map((cycle) => (
                <Card key={cycle} title={t(`billing.${cycle}`)}>
                  <p className="mb-4 text-2xl font-bold tnum">
                    {(quotes?.[cycle]?.amountMinor ?? data.prices[cycle]) / 100} {t('billing.sar')}
                  </p>
                  {quotes?.[cycle] && (
                    <p className="mb-4">
                      {t('billing.discount')}: {quotes[cycle].discountMinor / 100} {t('billing.sar')}
                    </p>
                  )}
                  <Button disabled={busy || !data.ready || (!!coupon.trim() && applied !== coupon.trim().toUpperCase())} onClick={() => subscribe(cycle)}>
                    {t('billing.pay')}
                  </Button>
                </Card>
              ))}
            </div>
          </>
        )
      )}
    </>
  )
}
