import { useI18n } from '../i18n/index.jsx'
import { day } from '../lib/format.js'
import { price } from './PagerPlans.jsx'

/**
 * What the pager plan will do next that costs or blocks something, shown before it happens
 * (GET /api/billing/pager):
 * - `renewsAtStandalone`: Plus bought at the Loyalty price after Loyalty ended. scheduled → it renews at the
 *   standalone price after {date}; otherwise its renewal was stopped and the owner can subscribe at that price.
 * - `basicRunning`: a standalone Basic still running with paid Loyalty; Plus can be bought once it ends.
 * @param {object} props
 * @param {object} props.data GET /api/billing/pager
 */
export default function PagerPlanNotices({ data }) {
  const { t, locale } = useI18n()
  const r = data?.renewsAtStandalone
  const b = data?.basicRunning
  if (!r && !b) return null
  return (
    <>
      {r && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {r.scheduled
            ? t(r.cycle === 'yearly' ? 'pager.console.renewsAtStandaloneYearly' : 'pager.console.renewsAtStandaloneMonthly', {
                date: day(r.until, locale),
                amount: price(r.cycle === 'yearly' ? r.yearly : r.monthly, locale),
              })
            : t('pager.console.renewsAtStandalone', { date: day(r.until, locale), monthly: price(r.monthly, locale), yearly: price(r.yearly, locale) })}
        </p>
      )}
      {b && <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">{t('pager.console.basicRunning', { date: day(b.until, locale) })}</p>}
    </>
  )
}
