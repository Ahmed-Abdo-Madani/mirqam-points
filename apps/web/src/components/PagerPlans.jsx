import { MqCheck } from '@mirqam/ui'
import { PAGER_PLANS, PAGER_TIERS, PAGER_TRIAL_DAYS } from '@mirqam-points/shared'
import { useI18n } from '../i18n/index.jsx'
import { money } from '../lib/format.js'
import { PAGER_LIVE_CARD_RELEASED } from './pager/flags.js'

/* Mirqam Pager plan cards. Every number comes from the plan catalog (packages/shared/src/pager-plans.js)
   or, in the console, from the API's offers for this workspace; never from copy. */

/** Whole riyals without decimals (29 ر.س), halalas only when there are some. */
export const price = (minor, locale) => (minor % 100 ? money(minor, locale) : locale === 'ar' ? `${minor / 100} ر.س` : `SAR ${minor / 100}`)

/** Monthly / yearly switch shared by the landing page and the console. */
export function CycleSwitch({ cycle, onChange }) {
  const { t } = useI18n()
  return (
    <fieldset aria-label={t('pager.title')} className="m-0 inline-flex rounded-full border border-line bg-surface p-1 text-sm font-semibold">
      {['monthly', 'yearly'].map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={cycle === c}
          onClick={() => onChange(c)}
          className={`min-h-9 rounded-full px-4 transition ${cycle === c ? 'bg-primary text-on-primary' : 'text-muted hover:text-ink'}`}
        >
          {t(`pager.${c}`)}
        </button>
      ))}
    </fieldset>
  )
}

/**
 * @param {object} props
 * @param {'monthly'|'yearly'} props.cycle
 * @param {Record<string,{monthly:number,yearly:number}>} [props.prices] per-tier prices for this workspace (defaults to list prices)
 * @param {boolean} [props.withLoyalty] the prices shown already are the Mirqam Loyalty ones
 * @param {(tier:string)=>import('react').ReactNode} [props.action] the card's button
 * @param {string} [props.highlight] tier to mark (current plan)
 * @param {boolean} [props.showPrices] false inside the native apps: no amounts at all
 */
export function PagerPlanCards({ cycle, prices, withLoyalty = false, action, highlight, showPrices = true }) {
  const { t, locale } = useI18n()
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {PAGER_TIERS.map((tier) => {
        const plan = PAGER_PLANS[tier]
        const amount = (prices?.[tier] ?? plan.prices)[cycle]
        // Not-yet-released features never sit in the ✓ list; they get their own «قريبًا» row.
        const soon = PAGER_LIVE_CARD_RELEASED ? [] : (plan.comingSoon ?? [])
        const features = plan.features.filter((f) => !soon.includes(f))
        return (
          <article key={tier} className={`mq-card flex flex-col p-7 ${highlight === tier ? 'ring-2 ring-accent' : ''}`}>
            <h3 className="text-lg font-bold">{t(`pager.tiers.${tier}`)}</h3>
            {showPrices && (
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="tnum text-[34px] font-bold leading-none">{price(amount, locale)}</span>
                <span className="text-sm text-muted">{t(cycle === 'monthly' ? 'pager.perMonth' : 'pager.perYear')}</span>
              </p>
            )}
            {showPrices &&
              (withLoyalty ? (
                <p className="mt-2 text-xs font-semibold text-accent">{t('pager.withLoyaltyApplied')}</p>
              ) : (
                // The with-Loyalty price is monthly only: the yearly one is not confirmed.
                cycle === 'monthly' && <p className="mt-2 text-xs text-muted">{t('pager.withLoyalty', { amount: price(plan.withLoyalty.monthly, locale) })}</p>
              ))}
            {plan.freeWithPosAdvanced && <p className="mt-1 text-xs text-muted">{t('pager.freeWithPos')}</p>}
            <ul className="mt-5 grid gap-2.5 text-sm">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <MqCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>{t(`pager.features.${f}`)}</span>
                </li>
              ))}
            </ul>
            {soon.map((f) => (
              <p key={f} className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
                <span>{t(`pager.features.${f}`)}</span>
                <span className="shrink-0 rounded-full bg-[#ffe7a6] px-2 py-0.5 text-[11px] font-bold text-[#5a4300]">{t('pager.soon')}</span>
              </p>
            ))}
            {action && <div className="mt-auto pt-6">{action(tier)}</div>}
          </article>
        )
      })}
    </div>
  )
}

/** Fine print under the cards: VAT and the trial. */
export function PagerFinePrint() {
  const { t } = useI18n()
  return (
    <p className="mt-4 text-center text-xs text-muted">
      {t('pager.vat')} · {t('pager.trial', { days: PAGER_TRIAL_DAYS })} · {t('pager.yearlyNote')}
    </p>
  )
}
