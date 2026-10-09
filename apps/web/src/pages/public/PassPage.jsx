import { EmptyState, MqPass, Skeleton } from '@mirqam/ui'
import { useParams } from 'react-router-dom'
import PassPreview from '../../components/PassPreview.jsx'
import Qr from '../../components/Qr.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useApi } from '../../lib/api.js'
import { num } from '../../lib/format.js'
import PublicCardShell from './PublicCardShell.jsx'
import WalletButtons from './WalletButtons.jsx'

/** /p/:token — a member's loyalty card: live balance, counter QR, add to wallet. */
export default function PassPage() {
  const { token } = useParams()
  const { t } = useI18n()
  const { data, error } = useApi(`/public/pass/${token}`)
  const unit = data?.type === 'stamps' ? t('pass.stamps') : t('pass.points')
  return (
    <PublicCardShell>
      {error ? (
        <EmptyState icon={MqPass} title={t('pass.notFound')} desc={t('pass.notFoundBody')} />
      ) : !data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="fade-in grid gap-6">
          <div className="flex justify-center">
            <PassPreview
              merchant={data.merchant}
              programName={data.programName}
              type={data.type}
              balance={data.balance}
              stampsRequired={data.stampsRequired ?? 10}
              memberName={data.memberName}
              labels={{ balance: unit, member: t('pass.member') }}
              design={data.design}
            />
          </div>
          {data.type === 'stamps' && data.stampsRequired && (
            <p className="text-center text-sm font-semibold">
              {data.balance >= data.stampsRequired ? t('members.rewardReady') : t('members.stampsToGo', { n: num(data.stampsRequired - data.balance) })}
            </p>
          )}
          {data.design?.rewardText && <p className="rounded-2xl bg-tint px-4 py-3 text-center text-sm">{data.design.rewardText}</p>}
          <WalletButtons wallet={data.wallet} />
          <section className="mq-card flex flex-col items-center gap-3 p-6 text-center">
            <h2 className="text-sm font-bold">{t('pass.showAtCounter')}</h2>
            <Qr value={data.barcode} size={180} label={t('pass.qrLabel')} />
            <p className="tnum text-xs text-muted" dir="ltr">
              {data.code}
            </p>
          </section>
          <p className="text-center text-xs leading-relaxed text-muted">{t('pass.keepPrivate')}</p>
        </div>
      )}
    </PublicCardShell>
  )
}
