import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Logo,
  MqBadgeCheck,
  MqCoins,
  MqCopy,
  MqDownload,
  MqLogOut,
  MqRefresh,
  MqSearch,
  MqStamp,
  MqStore,
  MqTrendUp,
  MqUsers,
  Skeleton,
  Stat,
  ThemeToggle,
  useToast,
} from '@mirqam/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { downloadCsv } from '../components/hq/csv.js'
import { amount, hqDateTime, hqDay, isoDay } from '../components/hq/format.js'
import MerchantProfile, { copyText } from '../components/hq/MerchantProfile.jsx'
import { ENTITLEMENT_STATES, EntitlementBadge, entitlementLabel, Facts, SectionError, StatusBadge } from '../components/hq/parts.jsx'
import Pagination from '../components/Pagination.jsx'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api, useApi } from '../lib/api.js'
import { num } from '../lib/format.js'
import { useSession } from '../lib/session.jsx'

const CENTER = 'https://mirqam.sa/m/ad0ed94a6a279f02a1295ae283efa07d2c18'
const PAGE = 25
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function HqEntry() {
  const { t } = useI18n(),
    once = useRef(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    const code = location.hash.slice(1)
    history.replaceState(null, '', '/hq-entry')
    if (!/^[a-f0-9]{64}$/.test(code)) {
      setFailed(true)
      return
    }
    api('/hq-entry', { method: 'POST', body: { code } })
      .then(() => location.replace('/hq-admin'))
      .catch(() => setFailed(true))
  }, [])
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card title={t('hq.title')} className="max-w-lg">
        <p role="status" className="text-muted">
          {t(failed ? 'hq.failed' : 'hq.entering')}
        </p>
        {failed && (
          <a className="mt-4 inline-block font-semibold text-accent" href={CENTER}>
            {t('hq.back')}
          </a>
        )}
      </Card>
    </main>
  )
}

/** Platform KPIs. Every figure is labelled with its definition; null means unavailable, never 0. */
function Overview({ refresh }) {
  const { t, locale } = useI18n()
  const { data, error, loading, reload } = useApi(`/hq-admin${refresh ? `?refresh=${refresh}` : ''}`)
  if (loading && !data) return <Skeleton rows={3} label={t('hq.loading')} />
  if (error && !data) return <SectionError error={error} onRetry={reload} />
  const value = (n) => (n == null ? t('hq.unavailable') : num(n))
  const { merchants: m, members, ledger30d: flows, entitlement, giftCards, collections, pos } = data
  return (
    <section aria-labelledby="hq-kpis" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="hq-kpis" className="text-lg font-bold">
            {t('hq.kpi.title')}
          </h2>
          <p className="text-xs text-muted">{t('hq.kpi.subtitle')}</p>
        </div>
        <p className="text-xs text-muted">
          {t('hq.updated')}: <span className="tnum">{hqDateTime(data.asOf, locale)}</span>
        </p>
      </div>
      {error && <SectionError error={error} onRetry={reload} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat icon={MqStore} label={t('hq.kpi.open')} value={value(m?.open)} hint={m && t('hq.kpi.openHint', { n: num(m.new30d) })} />
        <Stat icon={MqBadgeCheck} tone="green" label={t('hq.kpi.entitled')} value={value(m?.entitled)} hint={t('hq.kpi.entitledHint')} />
        <Stat icon={MqTrendUp} label={t('hq.kpi.transacting')} value={value(m?.transacting30d)} hint={t('hq.kpi.transactingHint')} />
        <Stat icon={MqUsers} tone="navy" label={t('hq.kpi.members')} value={value(members?.total)} hint={members && t('hq.kpi.membersHint', { n: num(members.new30d) })} />
        <Stat tone="navy" label={t('hq.kpi.programs')} value={value(members?.activePrograms)} hint={t('hq.kpi.programsHint')} />
      </div>
      <h3 className="pt-2 text-sm font-bold">{t('hq.kpi.activity')}</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={MqCoins} label={t('hq.kpi.pointsIssued')} value={value(flows?.points.issued)} hint={t('hq.kpi.grossHint')} />
        <Stat icon={MqCoins} tone="amber" label={t('hq.kpi.pointsRedeemed')} value={value(flows?.points.redeemed)} hint={t('hq.kpi.grossHint')} />
        <Stat icon={MqStamp} label={t('hq.kpi.stampsIssued')} value={value(flows?.stamps.issued)} hint={t('hq.kpi.grossHint')} />
        <Stat icon={MqStamp} tone="amber" label={t('hq.kpi.stampsRedeemed')} value={value(flows?.stamps.redeemed)} hint={t('hq.kpi.grossHint')} />
      </div>
      <p className="text-xs text-muted">{t('hq.kpi.unitsNote')}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('hq.ent.title')} subtitle={t('hq.ent.note')}>
          {entitlement ? (
            <Facts items={ENTITLEMENT_STATES.map((s) => [<EntitlementBadge key={s} state={s} />, num(entitlement[s])])} />
          ) : (
            <p className="text-sm text-muted">{t('hq.unavailable')}</p>
          )}
        </Card>
        <Card title={t('hq.money.title')}>
          <p className="text-xs font-semibold text-muted">{t('hq.money.giftLiability')}</p>
          {giftCards == null ? (
            <p className="py-2 text-sm">{t('hq.unavailable')}</p>
          ) : giftCards.length ? (
            giftCards.map((g) => (
              <p key={g.currency} className="py-1">
                <strong className="tnum text-xl">{amount(g.outstandingMinor, g.currency, locale)}</strong>
                <span className="block text-xs text-muted">{t('hq.money.giftHint', { n: num(g.cards) })}</span>
              </p>
            ))
          ) : (
            <p className="py-2 text-sm text-muted">{t('hq.money.none')}</p>
          )}
          <p className="mt-4 border-t border-line pt-4 text-xs font-semibold text-muted">{t('hq.money.collections')}</p>
          {collections.totals == null ? (
            <p className="py-2 text-sm">{t('hq.unavailable')}</p>
          ) : collections.totals.length ? (
            collections.totals.map((c) => (
              <p key={c.currency} className="py-1">
                <strong className="tnum text-xl">{amount(c.amountMinor, c.currency, locale)}</strong>
                <span className="block text-xs text-muted">{t('hq.money.collectionsHint', { n: num(c.payments) })}</span>
              </p>
            ))
          ) : (
            <p className="py-2 text-sm text-muted">{t('hq.money.none')}</p>
          )}
          {collections.remoteBilling && <p className="mt-2 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">{t('hq.money.remoteNote')}</p>}
        </Card>
        <Card title={t('hq.pos.title')} subtitle={t('hq.pos.note')}>
          {pos ? (
            <Facts
              items={[
                [t('hq.pos.links'), num(pos.activeLinks)],
                [t('hq.pos.managed'), num(pos.managedWorkspaces)],
                [t('hq.pos.stale'), pos.staleOpenSales ? <Badge tone="amber">{num(pos.staleOpenSales)}</Badge> : num(0)],
              ]}
            />
          ) : (
            <p className="text-sm text-muted">{t('hq.unavailable')}</p>
          )}
          <p className="mt-4 border-t border-line pt-4 text-xs font-semibold text-muted">{t('hq.wallet')}</p>
          <Facts
            items={[
              [t('hq.walletApple'), <WalletBadge key="a" on={data.wallet?.apple} />],
              [t('hq.walletGoogle'), <WalletBadge key="g" on={data.wallet?.google} />],
            ]}
          />
        </Card>
      </div>
    </section>
  )
}

function WalletBadge({ on }) {
  const { t } = useI18n()
  return on ? <Badge tone="green">{t('hq.walletOn')}</Badge> : <Badge>{t('hq.walletOff')}</Badge>
}

/** The merchant list: server-side search and pagination, CSV export of every matching row. */
function Merchants({ refresh }) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const errorText = useErrorText()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [exporting, setExporting] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(id)
  }, [q])
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (query) params.set('q', query)
  if (refresh) params.set('r', String(refresh))
  const { data, error, loading, reload } = useApi(`/hq-admin/tenants?${params}`)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const items = []
      for (let at = 0; at <= 100_000; at += 100) {
        const p = new URLSearchParams({ limit: '100', offset: String(at) })
        if (query) p.set('q', query)
        const page = await api(`/hq-admin/tenants?${p}`)
        items.push(...page.items)
        if (!page.items.length || items.length >= page.total) break
      }
      // Business records only: no member, owner or contact data leaves the console.
      downloadCsv(`mirqam-loyalty-businesses-${isoDay(new Date())}.csv`, [
        [
          t('hq.list.id'),
          t('hq.list.name'),
          t('hq.list.slug'),
          t('hq.list.status'),
          t('hq.list.entitlement'),
          t('hq.list.programs'),
          t('hq.list.members'),
          t('hq.list.lastActivity'),
          t('hq.list.created'),
        ],
        ...items.map((x) => [
          x.id,
          x.name,
          x.slug,
          t(x.status === 'closed' ? 'hq.status.closed' : 'hq.status.open'),
          x.entitlement ? entitlementLabel(t, x.entitlement) : '',
          x.activePrograms,
          x.members,
          isoDay(x.lastActivityAt),
          isoDay(x.createdAt),
        ]),
      ])
    } catch (err) {
      toast(errorText(err), 'err')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card
      title={t('hq.list.title')}
      subtitle={t('hq.list.subtitle')}
      bodyClass=""
      action={
        <Button variant="outline" size="sm" loading={exporting} disabled={!data?.total} onClick={exportCsv}>
          <MqDownload className="h-4 w-4" />
          {t('hq.list.export')}
        </Button>
      }
    >
      <div className="border-b border-line p-4">
        <label className="relative block max-w-md">
          <span className="sr-only">{t('hq.list.search')}</span>
          <MqSearch className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('hq.list.search')} className="ps-10" type="search" />
        </label>
      </div>
      {error && (
        <div className="p-4">
          <SectionError error={error} onRetry={reload} />
        </div>
      )}
      {loading && !data ? (
        <Skeleton className="px-6" rows={3} label={t('hq.loading')} />
      ) : !data ? null : !data.items.length ? (
        <EmptyState icon={MqStore} title={t(query ? 'hq.list.noResults' : 'hq.list.emptyTitle')} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="border-b border-line">
                <tr>
                  <th className="th-base">{t('hq.list.name')}</th>
                  <th className="th-base">{t('hq.list.status')}</th>
                  <th className="th-base">{t('hq.list.entitlement')}</th>
                  <th className="th-base">{t('hq.list.programs')}</th>
                  <th className="th-base">{t('hq.list.members')}</th>
                  <th className="th-base">{t('hq.list.lastActivity')}</th>
                  <th className="th-base">{t('hq.list.created')}</th>
                  <th className="th-base">
                    <span className="sr-only">{t('hq.list.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="td-base">
                      <Link to={`/hq-admin?tenant=${x.id}`} className="font-semibold hover:text-accent">
                        {x.name}
                      </Link>
                      <div className="tnum text-xs text-muted" dir="ltr">
                        {x.slug}
                      </div>
                    </td>
                    <td className="td-base">
                      <StatusBadge status={x.status} />
                    </td>
                    <td className="td-base">{x.entitlement ? <EntitlementBadge state={x.entitlement} /> : '—'}</td>
                    <td className="td-base tnum">{num(x.activePrograms)}</td>
                    <td className="td-base tnum">{num(x.members)}</td>
                    <td className="td-base tnum text-muted">{x.lastActivityAt ? hqDay(x.lastActivityAt, locale) : t('hq.profile.never')}</td>
                    <td className="td-base tnum text-muted">{hqDay(x.createdAt, locale)}</td>
                    <td className="td-base">
                      <span className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="sm" aria-label={t('hq.list.copyId')} title={t('hq.list.copyId')} onClick={() => copyText(x.id, toast, t)}>
                          <MqCopy className="h-4 w-4" />
                        </Button>
                        <Link
                          to={`/hq-admin?tenant=${x.id}`}
                          className="inline-flex min-h-9 items-center whitespace-nowrap rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-ink transition hover:border-brand-500 hover:text-accent"
                        >
                          {t('hq.list.view')}
                        </Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
        </>
      )}
    </Card>
  )
}

export default function HqAdmin() {
  const { t, locale, setLocale } = useI18n()
  const { logout } = useSession()
  const [params, setParams] = useSearchParams()
  const tenantId = params.get('tenant')
  const [refresh, setRefresh] = useState(0)
  const [signedOut, setSignedOut] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // A profile opened from the list starts at the top of the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each change of the selected merchant.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tenantId])
  const signOut = async () => {
    setLeaving(true)
    await logout()
    setLeaving(false)
    setSignedOut(true)
  }
  return (
    <main className="min-h-screen p-4 text-ink sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Logo label={t('brand.label')} />
            <h1 className="text-2xl font-bold">{t('hq.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href={CENTER} className="font-semibold text-accent">
              {t('hq.back')}
            </a>
            <ThemeToggle labels={{ toDark: t('common.darkMode'), toLight: t('common.lightMode') }} />
            <Button variant="outline" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
              {t('common.otherLanguage')}
            </Button>
            {!signedOut && (
              <>
                <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
                  <MqRefresh className="h-4 w-4" />
                  {t('hq.refresh')}
                </Button>
                <Button onClick={signOut} loading={leaving}>
                  <MqLogOut className="h-4 w-4 rtl:rotate-180" />
                  {t('hq.signOut')}
                </Button>
              </>
            )}
          </div>
        </header>
        {signedOut ? (
          <Card className="max-w-lg">
            <p role="status">{t('hq.signedOut')}</p>
            <a className="mt-4 inline-block font-semibold text-accent" href={CENTER}>
              {t('hq.back')}
            </a>
          </Card>
        ) : tenantId ? (
          UUID.test(tenantId) ? (
            <MerchantProfile id={tenantId} refresh={refresh} onBack={() => setParams({})} />
          ) : (
            <EmptyState icon={MqStore} title={t('hq.profile.notFound')} action={<Link to="/hq-admin">{t('hq.profile.back')}</Link>} />
          )
        ) : (
          <>
            <Overview refresh={refresh} />
            <Merchants refresh={refresh} />
          </>
        )}
      </div>
    </main>
  )
}
