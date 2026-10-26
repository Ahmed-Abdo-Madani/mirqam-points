import { EmptyState, MqPass, Skeleton } from '@mirqam/ui'
import { useParams } from 'react-router-dom'
import Barcode from '../../components/Barcode.jsx'
import PassPreview from '../../components/PassPreview.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useApi } from '../../lib/api.js'
import { num } from '../../lib/format.js'
import { passLabels } from '../app/CardDesign.jsx'
import PublicCardShell from './PublicCardShell.jsx'
import WalletButtons from './WalletButtons.jsx'

/** /p/:token — a member's loyalty card: live balance, counter QR, add to wallet. */
export default function PassPage() {
  const { token } = useParams()
  const { t } = useI18n()
  const { data, error } = useApi(`/public/pass/${token}`)
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
              lifetime={data.lifetime}
              code={data.code}
              labels={passLabels(t, data.type)}
              design={data.design}
              logoUrl={data.logoUrl}
              stampImage={data.stampImage}
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
            <Barcode format={data.design?.barcode} value={data.barcode} size={data.design?.barcode === 'pdf417' ? 260 : 180} label={t('pass.qrLabel')} />
            <p className="tnum text-xs text-muted" dir="ltr">
              {data.code}
            </p>
          </section>
          {data.design?.notes?.length > 0 && (
            <dl className="mq-card grid gap-3 p-5 text-sm">
              {data.design.notes.map((n, i) => (
                <div key={i}>
                  <dt className="text-xs text-muted">{n.label}</dt>
                  <dd className="mt-0.5 break-words">{n.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-center text-xs leading-relaxed text-muted">{t('pass.keepPrivate')}</p>
        </div>
      )}
    </PublicCardShell>
  )
}
