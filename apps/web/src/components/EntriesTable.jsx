import { Badge } from '@mirqam/ui'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/index.jsx'
import { dateTime, money, signed } from '../lib/format.js'

const KIND_TONE = { earn: 'green', redeem: 'blue', adjust: 'amber', void: 'red', expire: 'gray' }

/** Ledger entries. `onVoid(entry)` adds a void action for eligible rows. */
export default function EntriesTable({ items, compact = false, showMember = true, onVoid }) {
  const { t, locale } = useI18n()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-b border-line">
          <tr>
            <th className="th-base">{t('activity.when')}</th>
            {showMember && <th className="th-base">{t('activity.member')}</th>}
            <th className="th-base">{t('activity.type')}</th>
            <th className="th-base">{t('activity.program')}</th>
            <th className="th-base text-end">{t('activity.amount')}</th>
            {!compact && <th className="th-base text-end">{t('activity.balanceAfter')}</th>}
            {!compact && <th className="th-base">{t('activity.details')}</th>}
            {onVoid && <th className="th-base" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((e) => (
            <tr key={e.id} className={`transition hover:bg-brand-500/[0.03] ${e.voided ? 'opacity-60' : ''}`}>
              <td className="td-base whitespace-nowrap text-muted">{dateTime(e.createdAt, locale)}</td>
              {showMember && (
                <td className="td-base">
                  {e.member.phone ? (
                    <Link to={`/app/members/${e.member.id}`} className="font-semibold hover:text-accent">
                      {e.member.name || <span dir="ltr">{e.member.phone}</span>}
                    </Link>
                  ) : (
                    // Erased at the member's request: the amounts stay, the person does not.
                    <span className="text-muted">{t('members.erased')}</span>
                  )}
                </td>
              )}
              <td className="td-base">
                <Badge tone={KIND_TONE[e.kind]}>{t(`kinds.${e.kind}`)}</Badge>
                {e.voided && <span className="ms-2 text-xs text-err">{t('activity.voided')}</span>}
              </td>
              <td className="td-base text-muted">{e.program?.name}</td>
              <td className={`td-base tnum text-end font-bold ${e.amount > 0 ? 'text-ok' : 'text-ink'}`} dir="ltr">
                {signed(e.amount)}
              </td>
              {!compact && (
                <td className="td-base tnum text-end text-muted" dir="ltr">
                  {e.balanceAfter}
                </td>
              )}
              {!compact && (
                <td className="td-base max-w-56 truncate text-xs text-muted">
                  {[e.purchaseMinor != null && money(e.purchaseMinor, locale), e.note, e.ref, e.actorName].filter(Boolean).join(' · ')}
                </td>
              )}
              {onVoid && (
                <td className="td-base text-end">
                  {e.kind !== 'void' && !e.voided && (
                    <button type="button" onClick={() => onVoid(e)} className="text-xs font-semibold text-err hover:underline">
                      {t('activity.void')}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
