import { Badge, EmptyState, MqGift, Skeleton } from '@mirqam/ui'
import { useParams } from 'react-router-dom'
import Qr from '../../components/Qr.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useApi } from '../../lib/api.js'
import { day, money } from '../../lib/format.js'
import PublicCardShell from './PublicCardShell.jsx'
import WalletButtons from './WalletButtons.jsx'

/** /gift/:token — the recipient's gift card. The link itself is the card: anyone holding it can spend it. */
export default function GiftPage() {
  const { token } = useParams()
  const { t, locale } = useI18n()
  const { data, error } = useApi(`/public/gift/${token}`)
  return (
    <PublicCardShell>
      {error ? (
        <EmptyState icon={MqGift} title={t('gift.notFound')} />
      ) : !data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="fade-in grid gap-6">
          <article className="mp-pass overflow-hidden p-6 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <small className="text-xs font-semibold">{t('gift.title')}</small>
                <p className="mt-1 text-xl font-bold">{data.merchant}</p>
              </div>
              <MqGift className="h-8 w-8 text-brand-300" />
            </div>
            <p className="mt-8 text-xs text-brand-200">{t('gift.balance')}</p>
            <p className="tnum text-[40px] font-bold leading-tight">{money(data.balanceMinor, locale)}</p>
            {data.recipientName && <p className="mt-3 text-sm">{t('gift.to', { name: data.recipientName })}</p>}
          </article>
          {data.status !== 'active' && (
            <p className="text-center">
              <Badge tone={data.status === 'voided' ? 'red' : 'amber'}>{t(`gift.status.${data.status}`)}</Badge>
            </p>
          )}
          {data.message && (
            <blockquote className="mq-card p-5 text-sm leading-relaxed">
              “{data.message}”{data.senderName && <footer className="mt-2 text-xs text-muted">— {data.senderName}</footer>}
            </blockquote>
          )}
          <WalletButtons wallet={data.wallet} />
          {data.status === 'active' && (
            <section className="mq-card flex flex-col items-center gap-3 p-6 text-center">
              <h2 className="text-sm font-bold">{t('gift.showAtCounter')}</h2>
              <Qr value={data.code.replaceAll('-', '')} size={180} label={t('gift.qrLabel')} />
              <p className="tnum font-mono text-sm font-bold tracking-wider" dir="ltr">
                {data.code}
              </p>
            </section>
          )}
          {data.expiresAt && <p className="text-center text-xs text-muted">{t('gift.expires', { date: day(data.expiresAt, locale) })}</p>}
          <p className="text-center text-xs leading-relaxed text-muted">{t('gift.keepPrivate')}</p>
        </div>
      )}
    </PublicCardShell>
  )
}
