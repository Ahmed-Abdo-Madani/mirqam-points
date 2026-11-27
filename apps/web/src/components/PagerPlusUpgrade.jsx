import { Button, Card } from '@mirqam/ui'
import { PAGER_MAX_BRANCHES } from '@mirqam-points/shared'
import { useState } from 'react'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api } from '../lib/api.js'
import { CycleSwitch, cycleChoice, price } from './PagerPlans.jsx'

/**
 * The one upgrade card a workspace with a paid Mirqam Loyalty plan sees: Basic is included, Plus is bought at
 * the Loyalty price the API offers (`offer.upgrade`, `offer.prices[upgrade]`: 25 / 250 per branch). Owner only.
 * @param {object} props
 * @param {object} props.offer GET /api/billing/pager
 * @param {string|null} [props.checkoutHost]
 * @param {() => void} [props.onDone]
 */
export default function PagerPlusUpgrade({ offer, checkoutHost, onDone }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const [cycle, setCycle] = useState('monthly')
  const [branches, setBranches] = useState(1)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const tier = offer?.upgrade
  const p = tier && offer.prices?.[tier]
  if (!p) return null
  const { shown } = cycleChoice(offer.cycles, cycle)
  const max = offer.maxBranches ?? PAGER_MAX_BRANCHES

  async function upgrade() {
    setBusy(true)
    setFailure(null)
    try {
      const r = await api('/billing/pager/checkout', {
        method: 'POST',
        body: { tier, cycle: shown, branches, autoRenew: true },
        idempotencyKey: crypto.randomUUID(),
      })
      if (!r.url) return onDone?.()
      const u = new URL(r.url)
      if (u.protocol !== 'https:' || (checkoutHost && u.hostname !== checkoutHost)) throw new Error('invalid_checkout')
      window.location.assign(u.href)
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('pager.console.upgradeTitle', { monthly: price(p.monthly, locale), yearly: price(p.yearly, locale) })}>
      <p className="text-sm text-muted">{t('pager.console.upgradeHint')}</p>
      {failure && (
        <p role="alert" className="mt-3 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <CycleSwitch cycle={shown} onChange={setCycle} />
        <label className="grid gap-1 text-sm">
          {t('pager.console.branches')}
          <input
            type="number"
            min={1}
            max={max}
            value={branches}
            onChange={(e) => setBranches(Math.min(max, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
            className="tnum w-28 rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        <Button disabled={busy || !offer.purchasable} loading={busy} onClick={upgrade}>
          {t('pager.console.upgrade')}
        </Button>
      </div>
      {branches > 1 && <p className="tnum mt-2 text-sm text-muted">{t('pager.console.total', { amount: price(p[shown] * branches, locale) })}</p>}
      {!offer.purchasable && <p className="mt-2 text-xs text-muted">{t('pager.console.unavailable')}</p>}
      <p className="mt-3 text-xs text-muted">{t('pager.vat')}</p>
    </Card>
  )
}
