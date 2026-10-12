import { Button, Card, Skeleton } from '@mirqam/ui'
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
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {['monthly', 'yearly'].map((cycle) => (
                <Card key={cycle} title={t(`billing.${cycle}`)}>
                  <p className="mb-4 text-2xl font-bold tnum">
                    {data.prices[cycle] / 100} {t('billing.sar')}
                  </p>
                  <Button disabled={busy || !data.ready} onClick={() => subscribe(cycle)}>
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
