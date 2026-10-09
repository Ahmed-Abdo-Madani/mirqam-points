import { Card, EmptyState, MqCheckCircle, MqCoins, MqLedger, MqReward, MqScan, MqTrendUp, MqUsers, Pattern, Skeleton, Stat } from '@mirqam/ui'
import { Link } from 'react-router-dom'
import EntriesTable from '../../components/EntriesTable.jsx'
import { useI18n } from '../../i18n/index.jsx'
import { useApi } from '../../lib/api.js'
import { num } from '../../lib/format.js'
import { useSession } from '../../lib/session.jsx'

function Onboarding({ programs, summary }) {
  const { t } = useI18n()
  const steps = [
    { done: programs.length > 0, label: t('dashboard.stepCreate'), to: '/app/programs' },
    { done: programs.some((p) => p.status === 'active'), label: t('dashboard.stepActivate'), to: '/app/programs' },
    { done: summary.members > 0, label: t('dashboard.stepMember'), to: '/app/members' },
    { done: summary.points.earned + summary.stamps.earned > 0, label: t('dashboard.stepEarn'), to: '/app/cashier' },
  ]
  if (steps.every((s) => s.done)) return null
  return (
    <Card title={t('dashboard.onboardingTitle')} subtitle={t('dashboard.onboardingSubtitle')} className="mb-6">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${s.done ? 'border-ok/20 bg-ok-bg text-ok' : 'border-line hover:border-brand-500'}`}
            >
              {s.done ? (
                <MqCheckCircle className="h-5 w-5 shrink-0" />
              ) : (
                <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-xs text-accent">{i + 1}</span>
              )}
              {s.label}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export default function Dashboard() {
  const { t } = useI18n()
  const { me, can } = useSession()
  const summary = useApi('/ledger/summary')
  const programs = useApi('/programs')
  const recent = useApi('/ledger/entries?limit=8')

  return (
    <>
      <section className="mp-welcome relative mb-6 overflow-hidden rounded-[28px] p-7 text-white sm:p-9">
        <Pattern variant="diamonds" opacity={0.07} className="text-brand-300" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="mq-kicker">{me.tenant.name}</p>
            <h1 className="mt-2 text-[clamp(22px,2.6vw,32px)] font-bold">{t('dashboard.welcome', { name: me.user.name.split(' ')[0] })}</h1>
            <p className="mt-2 max-w-xl text-sm leading-loose text-navy-200">{t('dashboard.welcomeBody')}</p>
          </div>
          {can('transact') && (
            <Link to="/app/cashier" className="inline-flex min-h-12 items-center gap-2 rounded-[15px] bg-white px-5 font-bold text-navy-900 hover:bg-brand-50">
              <MqScan className="h-5 w-5" />
              {t('dashboard.openCashier')}
            </Link>
          )}
        </div>
      </section>

      {summary.data && programs.data && <Onboarding programs={programs.data.items} summary={summary.data} />}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.loading && !summary.data ? (
          <Skeleton rows={1} className="sm:col-span-2 xl:col-span-4" />
        ) : (
          summary.data && (
            <>
              <Stat
                label={t('dashboard.members')}
                value={num(summary.data.members)}
                hint={t('dashboard.new30d', { n: num(summary.data.members30d) })}
                icon={MqUsers}
              />
              {/* Points lead; stamps are a different unit and are shown beside, never added. */}
              {[
                ['outstanding', MqCoins, 'amber'],
                ['earned', MqTrendUp, 'green'],
                ['redeemed', MqReward, 'navy'],
              ].map(([metric, icon, tone]) => (
                <Stat
                  key={metric}
                  label={t(`dashboard.${metric}`)}
                  value={num(summary.data.points[metric])}
                  hint={t('dashboard.pointsAndStamps', { n: num(summary.data.stamps[metric]) })}
                  icon={icon}
                  tone={tone}
                />
              ))}
            </>
          )
        )}
      </div>

      <Card
        title={t('dashboard.recent')}
        action={
          <Link to="/app/activity" className="text-sm font-semibold text-accent hover:underline">
            {t('common.viewAll')}
          </Link>
        }
        bodyClass=""
      >
        {recent.loading && !recent.data ? (
          <Skeleton className="px-6" />
        ) : recent.data?.items.length ? (
          <EntriesTable items={recent.data.items} compact />
        ) : (
          <EmptyState icon={MqLedger} title={t('activity.emptyTitle')} desc={t('activity.emptyBody')} />
        )}
      </Card>
    </>
  )
}
