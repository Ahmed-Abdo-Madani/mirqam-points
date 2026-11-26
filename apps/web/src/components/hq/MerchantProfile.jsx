import { Badge, Button, Card, EmptyState, MqArrowLeft, MqCopy, MqLink, MqRefresh, MqStore, Skeleton, useToast } from '@mirqam/ui'
import { useState } from 'react'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, publicOrigin, useApi } from '../../lib/api.js'
import { num } from '../../lib/format.js'
import { amount, hqDateTime, hqDay } from './format.js'
import { EntitlementBadge, Facts, SectionError, StatusBadge } from './parts.jsx'

const PROGRAM_STATUS = { active: 'programs.status.active', draft: 'programs.status.draft', archived: 'programs.status.archived' }
const EVENT = {
  activated: 'billing.event.activated',
  renewed: 'billing.event.renewed',
  plan_changed: 'billing.event.plan_changed',
  payment_failed: 'billing.event.payment_failed',
  expiring_soon: 'billing.event.expiring_soon',
  expired: 'billing.event.expired',
}
const cycleKey = (cycle) => (cycle === 'monthly' ? 'hq.monthly' : cycle === 'yearly' ? 'hq.yearly' : null)

export async function copyText(value, toast, t) {
  try {
    await navigator.clipboard.writeText(value)
    toast(t('common.copied'))
  } catch {
    toast(t('common.copyFailed'), 'err')
  }
}

/** One merchant on /hq-admin?tenant=<id>: counts and states only, never member data. */
export default function MerchantProfile({ id, refresh, onBack }) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const errorText = useErrorText()
  const { data, error, loading, reload } = useApi(`/hq-admin/tenants/${encodeURIComponent(id)}${refresh ? `?r=${refresh}` : ''}`)
  const [syncing, setSyncing] = useState(false)

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <MqArrowLeft className="h-4 w-4 rtl:rotate-180" />
      {t('hq.profile.back')}
    </Button>
  )
  if (loading && !data) return <Skeleton rows={4} label={t('hq.loading')} />
  if (error && error.status === 404)
    return <EmptyState icon={MqStore} title={t('hq.profile.notFound')} action={back} />
  if (error && !data)
    return (
      <div className="space-y-4">
        {back}
        <SectionError error={error} onRetry={reload} />
      </div>
    )

  const { tenant, entitlement: ent, subscription: sub } = data
  const sync = async () => {
    setSyncing(true)
    try {
      await api(`/hq-admin/tenants/${encodeURIComponent(tenant.id)}/billing-sync`, { method: 'POST' })
      toast(t('hq.profile.synced'))
      reload()
    } catch (err) {
      toast(errorText(err), 'err')
    } finally {
      setSyncing(false)
    }
  }
  const entitlementFacts = ent.available
    ? [
        [t('hq.profile.state'), <EntitlementBadge key="s" state={ent.state} />],
        ...(ent.expiresAt ? [[t('hq.profile.expiresAt'), hqDay(ent.expiresAt, locale)]] : []),
        ...(ent.trialEndsAt ? [[t('hq.profile.trialEndsAt'), hqDay(ent.trialEndsAt, locale)]] : []),
        ...(ent.daysLeft ? [[t('hq.profile.daysLeft'), num(ent.daysLeft)]] : []),
        ...(cycleKey(ent.cycle) ? [[t('hq.profile.cycle'), t(cycleKey(ent.cycle))]] : []),
        ...(ent.managedBy ? [[t('hq.profile.managedBy'), t('hq.ent.posManaged')]] : []),
        ...(ent.billingStatus ? [[t('hq.profile.billingStatus'), ent.billingStatus]] : []),
      ]
    : [[t('hq.profile.state'), tenant.status === 'closed' ? t('hq.status.closed') : t('hq.unavailable')]]

  return (
    <div className="space-y-6">
      {back}
      <Card bodyClass="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{tenant.name}</h2>
            <p className="tnum mt-0.5 text-xs text-muted" dir="ltr">
              {tenant.slug}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={tenant.status} />
              {ent.available && <EntitlementBadge state={ent.state} />}
              <span className="text-xs text-muted">
                {t('hq.profile.created')}: <span className="tnum">{hqDay(tenant.createdAt, locale)}</span>
              </span>
              {tenant.closedAt && (
                <span className="text-xs text-muted">
                  {t('hq.profile.closedAt')}: <span className="tnum">{hqDay(tenant.closedAt, locale)}</span>
                  {tenant.purgeAfter && (
                    <>
                      {' · '}
                      {t('hq.profile.purgeAfter')}: <span className="tnum">{hqDay(tenant.purgeAfter, locale)}</span>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" aria-label={t('hq.profile.actions')}>
            <Button variant="outline" size="sm" onClick={() => copyText(tenant.id, toast, t)}>
              <MqCopy className="h-4 w-4" />
              {t('hq.profile.copyId')}
            </Button>
            {data.joinPrograms.map((p) => (
              <a
                key={p.id}
                href={`${publicOrigin()}/join/${encodeURIComponent(tenant.slug)}/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-accent transition hover:border-brand-500"
              >
                <MqLink className="h-4 w-4" />
                {t('hq.profile.joinLink', { name: p.name })}
              </a>
            ))}
            {data.billing.syncAvailable && (
              <Button variant="outline" size="sm" loading={syncing} onClick={sync}>
                <MqRefresh className="h-4 w-4" />
                {t('hq.profile.sync')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('hq.profile.entitlement')}>
          <Facts items={entitlementFacts} />
        </Card>
        <Card title={t('hq.profile.usage')}>
          <Facts
            items={[
              [t('hq.profile.members'), num(data.members.total)],
              [t('hq.profile.new30d'), num(data.members.new30d)],
              [t('hq.profile.lastActivity'), data.lastActivityAt ? hqDateTime(data.lastActivityAt, locale) : t('hq.profile.never')],
              ...['points', 'stamps'].map((type) => [
                t(type === 'points' ? 'hq.profile.pointsPrograms' : 'hq.profile.stampsPrograms'),
                Object.entries(data.programs[type])
                  .filter(([, n]) => n > 0)
                  .map(([status, n]) => `${num(n)} ${t(PROGRAM_STATUS[status])}`)
                  .join(' · ') || '0',
              ]),
            ]}
          />
        </Card>
        <Card title={t('hq.profile.team')}>
          <Facts
            items={[
              [t('roles.owner'), num(data.team.owners)],
              [t('roles.manager'), num(data.team.staff.manager)],
              [t('roles.cashier'), num(data.team.staff.cashier)],
              [t('roles.analyst'), num(data.team.staff.analyst)],
            ]}
          />
        </Card>
        <Card title={t('hq.profile.giftCards')}>
          {data.giftCards.length ? (
            data.giftCards.map((g) => (
              <Facts
                key={g.currency}
                items={[
                  [t('hq.profile.cards'), num(g.cards)],
                  [t('hq.profile.voided'), num(g.voided)],
                  [t('hq.profile.issued'), amount(g.issuedMinor, g.currency, locale)],
                  [t('hq.profile.outstanding'), amount(g.outstandingMinor, g.currency, locale)],
                ]}
              />
            ))
          ) : (
            <p className="text-sm text-muted">{t('hq.profile.noGiftCards')}</p>
          )}
        </Card>
        <Card title={t('hq.pos.title')}>
          <Facts
            items={[
              [t('hq.pos.links'), num(data.pos.activeLinks)],
              [t('hq.profile.posManagedUntil'), data.pos.native ? hqDay(data.pos.managedUntil, locale) : t('hq.profile.no')],
              [t('hq.profile.posConfigured'), t(data.pos.configured ? 'hq.profile.yes' : 'hq.profile.no')],
              [t('hq.pos.stale'), num(data.pos.staleOpenSales)],
            ]}
          />
        </Card>
        <Card title={t('hq.profile.subscription')}>
          <Facts
            items={
              sub
                ? [
                    [t('hq.profile.cycle'), cycleKey(sub.cycle) ? t(cycleKey(sub.cycle)) : '—'],
                    [t('hq.profile.expiresAt'), hqDay(sub.expiresAt, locale)],
                    ...(sub.status ? [[t('hq.profile.billingStatus'), sub.status]] : []),
                    ...(sub.autoRenew !== undefined ? [[t('hq.profile.autoRenew'), t(sub.autoRenew ? 'hq.profile.yes' : 'hq.profile.no')]] : []),
                  ]
                : [[t('hq.profile.cycle'), t('hq.none')]]
            }
          />
          {data.billing.remote && <p className="mt-3 text-xs text-muted">{t('hq.profile.remoteNote')}</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('hq.profile.checkouts')} subtitle={t('hq.profile.checkoutsNote')} bodyClass="">
          {data.checkouts.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th-base">{t('hq.profile.date')}</th>
                    <th className="th-base">{t('hq.profile.cycle')}</th>
                    <th className="th-base">{t('hq.profile.amount')}</th>
                    <th className="th-base">{t('hq.list.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.checkouts.map((c) => (
                    <tr key={c.id}>
                      <td className="td-base tnum text-muted">{hqDateTime(c.paidAt || c.createdAt, locale)}</td>
                      <td className="td-base">{cycleKey(c.cycle) ? t(cycleKey(c.cycle)) : '—'}</td>
                      <td className="td-base tnum font-semibold">{amount(c.amountMinor, c.currency, locale)}</td>
                      <td className="td-base">
                        {c.status === 'paid' ? <Badge tone="green">{t('hq.profile.paid')}</Badge> : <Badge>{t('hq.profile.pending')}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-muted">{t('hq.profile.checkoutsEmpty')}</p>
          )}
        </Card>
        <Card title={t('hq.profile.events')} bodyClass="">
          {data.events.length ? (
            <ul className="divide-y divide-line">
              {data.events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span>{EVENT[e.kind] ? t(EVENT[e.kind]) : e.kind}</span>
                  <span className="tnum text-xs text-muted">{hqDateTime(e.createdAt, locale)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-muted">{t('hq.profile.eventsEmpty')}</p>
          )}
        </Card>
      </div>
      <p className="text-xs text-muted">
        {t('hq.updated')}: <span className="tnum">{hqDateTime(data.asOf, locale)}</span>
      </p>
    </div>
  )
}
