import { Badge, Button, Card, Skeleton } from '@mirqam/ui'
import { PAGER_MAX_BRANCHES } from '@mirqam-points/shared'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CycleSwitch, cycleChoice, PagerFinePrint, PagerPlanCards, price } from '../../components/PagerPlans.jsx'
import PagerPlusUpgrade from '../../components/PagerPlusUpgrade.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { day, money } from '../../lib/format.js'

const TONE = { trialing: 'blue', active: 'green', past_due: 'amber', suspended: 'red', canceled: 'gray', expired: 'gray' }

/* Mirqam Pager plan inside Billing: trial, subscribe per branch, and the way to the pager page (/app/pager). */
export default function PagerPlan({ checkoutHost }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const { data, loading, error, reload } = useApi('/billing/pager')
  const [cycle, setCycle] = useState('monthly')
  const [branches, setBranches] = useState(1)
  const [coupon, setCoupon] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)

  // Back from the payment page (?pager=paid): re-read the entitlement once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on mount.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('pager') !== 'paid') return
    api('/billing/pager/confirm', { method: 'POST', body: {} }).then(reload).catch(setFailure)
  }, [])

  // Arrived from a pager sign-up (#pager-plan-title): bring the pager plan into view once it has loaded.
  useEffect(() => {
    if (loading || window.location.hash !== '#pager-plan-title') return
    document.getElementById('pager-plan-title')?.scrollIntoView({ block: 'start' })
  }, [loading])

  async function act(fn) {
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

  const trial = (tier) =>
    act(async () => {
      await api('/billing/pager/trial', { method: 'POST', body: { tier } })
      reload()
    })

  const subscribe = (tier) =>
    act(async () => {
      const r = await api('/billing/pager/checkout', {
        method: 'POST',
        body: { tier, cycle: cycleChoice(data?.cycles, cycle).shown, branches, coupon: coupon.trim() || undefined, autoRenew: true },
        idempotencyKey: crypto.randomUUID(),
      })
      if (!r.url) return reload()
      const u = new URL(r.url)
      if (u.protocol !== 'https:' || (checkoutHost && u.hostname !== checkoutHost)) throw new Error('invalid_checkout')
      window.location.assign(u.href)
    })

  if (loading) return <Skeleton rows={2} />
  if (!data) return error ? <p className="text-sm text-err">{errorText(error)}</p> : null
  const sub = data.subscription
  const { shown } = cycleChoice(data.cycles, cycle)
  const total = data.prices.basic && ((tier) => data.prices[tier][shown] * branches)

  // Paid Mirqam Loyalty: Basic is included; Plus is the one thing to buy, at the Loyalty price.
  if (data.included)
    return (
      <section aria-labelledby="pager-plan-title" className="grid gap-3">
        <h2 id="pager-plan-title" className="scroll-mt-28 text-[17px] font-bold">
          {t('pager.console.title')}
        </h2>
        {failure && (
          <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
            {errorText(failure)}
          </p>
        )}
        {sub?.source === 'billing' ? (
          <Card
            title={`${t('pager.console.current')}: ${t(`pager.tiers.${sub.tier}`)}`}
            action={<Badge tone={TONE[sub.status]}>{t(`pager.console.status.${sub.status}`)}</Badge>}
          >
            <p className="text-sm">
              {t('pager.console.branches')}: <span className="tnum">{sub.branches}</span> · {t('pager.console.until', { date: day(sub.expiresAt, locale) })}
            </p>
            {sub.withLoyaltyPrice && <p className="mt-1 text-sm text-muted">{t('pager.console.loyaltyPricePlan')}</p>}
            <p className="mt-1 text-sm text-muted">{t('pager.console.basicStaysIncluded')}</p>
            <Link to="/app/pager" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-on-primary">
              {t('pager.console.openPager')}
            </Link>
          </Card>
        ) : (
          <Card title={t('pager.console.included')} action={<Badge tone="green">{t('pager.console.status.active')}</Badge>}>
            <p className="text-sm">{t('pager.console.includedHint')}</p>
            {sub?.replacedSubscription && (
              <p className="mt-2 text-sm text-muted">{t('pager.console.replaced', { date: day(sub.replacedSubscription.expiresAt, locale) })}</p>
            )}
            <Link to="/app/pager" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-on-primary">
              {t('pager.console.openPager')}
            </Link>
          </Card>
        )}
        <PagerPlusUpgrade offer={data} checkoutHost={checkoutHost} onDone={reload} />
      </section>
    )

  return (
    <section aria-labelledby="pager-plan-title" className="grid gap-4">
      <div>
        <h2 id="pager-plan-title" className="scroll-mt-28 text-[17px] font-bold">
          {t('pager.console.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('pager.console.intro')}</p>
      </div>
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      {sub && (
        <Card
          title={`${t('pager.console.current')}: ${t(`pager.tiers.${sub.tier}`)}`}
          action={<Badge tone={TONE[sub.status]}>{t(`pager.console.status.${sub.status}`)}</Badge>}
        >
          <p className="text-sm">
            {t('pager.console.branches')}: <span className="tnum">{sub.branches}</span> · {t('pager.console.until', { date: day(sub.expiresAt, locale) })}
          </p>
          {data.renewsAtStandalone && (
            <p className="mt-2 text-sm">
              {t('pager.console.renewsAtStandalone', {
                date: day(data.renewsAtStandalone.until, locale),
                monthly: price(data.renewsAtStandalone.monthly, locale),
                yearly: price(data.renewsAtStandalone.yearly, locale),
              })}
            </p>
          )}
          {sub.active && (
            <Link to="/app/pager" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-on-primary">
              {t('pager.console.openPager')}
            </Link>
          )}
        </Card>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <CycleSwitch cycle={shown} onChange={setCycle} />
        <label className="grid gap-1 text-sm">
          {t('pager.console.branches')}
          <input
            type="number"
            min={1}
            max={data.maxBranches ?? PAGER_MAX_BRANCHES}
            value={branches}
            onChange={(e) => setBranches(Math.min(data.maxBranches ?? PAGER_MAX_BRANCHES, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
            className="tnum w-28 rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('billing.coupon')}
          <input
            value={coupon}
            maxLength={40}
            onChange={(e) => setCoupon(e.target.value)}
            className="w-40 rounded-lg border border-line bg-surface px-3 py-2 uppercase"
          />
        </label>
      </div>
      <PagerPlanCards
        cycle={shown}
        prices={data.prices}
        highlight={sub?.active ? sub.tier : undefined}
        action={(tier) => (
          <div className="grid gap-2">
            {total && branches > 1 && <p className="tnum text-sm text-muted">{t('pager.console.total', { amount: money(total(tier), locale) })}</p>}
            {data.trialAvailable && (
              <Button variant="outline" disabled={busy} onClick={() => trial(tier)}>
                {t('pager.console.startTrial', { days: data.trialDays })}
              </Button>
            )}
            <Button disabled={busy || !data.purchasable} loading={busy} onClick={() => subscribe(tier)}>
              {t('pager.console.subscribe')}
            </Button>
            {!data.purchasable && <p className="text-xs text-muted">{t('pager.console.unavailable')}</p>}
          </div>
        )}
      />
      <PagerFinePrint />
    </section>
  )
}
