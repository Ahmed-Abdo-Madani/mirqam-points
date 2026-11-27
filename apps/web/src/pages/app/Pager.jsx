import { Badge, Button, Card, Skeleton } from '@mirqam/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/AppShell.jsx'
import PagerPlanNotices from '../../components/PagerPlanNotices.jsx'
import { PagerFinePrint, PagerPlanCards } from '../../components/PagerPlans.jsx'
import PagerPlusUpgrade from '../../components/PagerPlusUpgrade.jsx'
import Qr from '../../components/Qr.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { canEditBusiness, counterColumns, nextStartingWatch, pagerPageState, pickBranch, SUPPORT_WHATSAPP, startingGaveUp } from '../../lib/pager-page.js'
import { PURCHASES_IN_APP } from '../../lib/platform.js'
import { useSession } from '../../lib/session.jsx'

const POLL_MS = 3000
const minutes = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))

/* Mirqam Pager inside Mirqam Loyalty: the counter (new number, call, done) for every staff role, and for
   owners and managers the counter QR, TV link, branches, settings, brand and reports. The POS API is the
   engine behind /api/pager (no Cashier app, no second account). */
export default function Pager() {
  const { t } = useI18n()
  const { can } = useSession()
  const { data, loading, error, reload } = useApi('/pager')
  const state = pagerPageState({ data, error, loading })
  const [tab, setTab] = useState('counter')

  // While the first activation reaches the POS, look again every few seconds (each answer starts the next
  // wait, so looks never overlap); give up after 3 failed tries or 60 seconds.
  const [watch, setWatch] = useState(null)
  useEffect(() => {
    if (state !== 'starting') {
      setWatch(null)
      return
    }
    setWatch((w) => nextStartingWatch(w, data))
  }, [state, data])
  const gaveUp = state === 'starting' && startingGaveUp(watch)
  useEffect(() => {
    if (state !== 'starting' || !watch || startingGaveUp(watch)) return undefined
    const timer = setTimeout(reload, 4000)
    return () => clearTimeout(timer)
  }, [state, watch, reload])
  const retrySetup = () => {
    setWatch(null)
    reload()
  }

  return (
    <>
      <PageHeader title={t('pager.page.title')} subtitle={t('pager.page.subtitle')} />
      {state === 'loading' && <Skeleton rows={3} />}
      {state === 'unavailable' && <Unavailable onRetry={reload} />}
      {gaveUp && <SetupFailed onRetry={retrySetup} />}
      {state === 'starting' && !gaveUp && (
        <Card>
          <p role="status" className="text-sm">
            {t('pager.page.starting')}
          </p>
        </Card>
      )}
      {state === 'no_plan' && <NoPlan plan={data?.plan} onStarted={reload} />}
      {state === 'live' && (
        <>
          {can('manage') && (
            <div role="tablist" className="no-print mb-5 inline-flex rounded-full border border-line bg-surface p-1 text-sm font-semibold">
              {['counter', 'manage'].map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`min-h-10 rounded-full px-5 ${tab === k ? 'bg-primary text-on-primary' : 'text-muted hover:text-ink'}`}
                >
                  {t(`pager.page.tab.${k}`)}
                </button>
              ))}
            </div>
          )}
          {tab === 'counter' || !can('manage') ? <Counter state={data} /> : <Manage state={data} reload={reload} />}
        </>
      )}
    </>
  )
}

function Unavailable({ onRetry }) {
  const { t } = useI18n()
  return (
    <Card>
      <p role="alert" className="text-sm">
        {t('pager.page.unavailable')}
      </p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>
        {t('pager.page.retry')}
      </Button>
    </Card>
  )
}

/** The first setup did not finish in time: say so plainly, Retry, and the way to Mirqam on WhatsApp. */
function SetupFailed({ onRetry }) {
  const { t } = useI18n()
  return (
    <Card>
      <p role="alert" className="text-sm">
        {t('pager.page.setupFailed')}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" onClick={onRetry}>
          {t('pager.page.retry')}
        </Button>
        <a
          href={SUPPORT_WHATSAPP}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-accent"
        >
          {t('pager.page.contactWhatsapp')}
        </a>
      </div>
    </Card>
  )
}

/** No live plan: what the pager is, the trial and the prices (owner on the website only). */
function NoPlan({ plan, onStarted }) {
  const { t } = useI18n()
  const { can } = useSession()
  const errorText = useErrorText()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const owner = can('owner') && PURCHASES_IN_APP
  async function trial(tier) {
    setBusy(true)
    setFailure(null)
    try {
      await api('/billing/pager/trial', { method: 'POST', body: { tier } })
      onStarted()
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4">
      {plan?.lapsedFromLoyalty && (
        <Card>
          <p className="text-sm leading-relaxed">{t('pager.page.lapsedLoyalty')}</p>
          {owner && (
            <Link to="/app/billing" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-on-primary">
              {t('pager.page.renewLoyalty')}
            </Link>
          )}
        </Card>
      )}
      <Card>
        <p className="text-sm leading-relaxed">{t(plan?.lapsedFromLoyalty ? 'pager.page.orStandalone' : 'pager.page.noPlan')}</p>
        {!owner && <p className="mt-2 text-sm text-muted">{t(PURCHASES_IN_APP ? 'pager.page.askOwner' : 'pager.page.notOnYet')}</p>}
      </Card>
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      {owner && (
        <>
          <PagerPlanCards
            cycle="monthly"
            prices={plan?.prices}
            action={(tier) =>
              plan?.trialAvailable !== false ? (
                <Button className="w-full" size="lg" loading={busy} onClick={() => trial(tier)}>
                  {t('pager.console.startTrial', { days: plan?.trialDays ?? 14 })}
                </Button>
              ) : (
                <Link to="/app/billing#pager-plan-title" className="font-semibold text-accent underline">
                  {t('pager.page.subscribe')}
                </Link>
              )
            }
          />
          <PagerFinePrint />
        </>
      )}
    </div>
  )
}

/** The counter a cashier runs one-handed at the till. Polls the list every few seconds (cheap when nothing changed). */
function Counter({ state }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const { me } = useSession()
  const key = `mirqam-pager-branch:${me?.tenant?.id ?? ''}`
  const [branchId, setBranchId] = useState(() => pickBranch(state.branches, localStorage.getItem(key)))
  const [tickets, setTickets] = useState([])
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(null)
  const [failure, setFailure] = useState(null)
  const [shown, setShown] = useState(null)
  const version = useRef('')

  const load = useCallback(async () => {
    if (!branchId) return
    try {
      const r = await api(`/pager/branches/${encodeURIComponent(branchId)}/tickets${version.current ? `?version=${encodeURIComponent(version.current)}` : ''}`)
      setOffline(false)
      if (r.changed) {
        version.current = r.version
        setTickets(r.tickets)
      }
    } catch {
      setOffline(true)
    }
  }, [branchId])

  useEffect(() => {
    version.current = ''
    setTickets([])
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  async function run(id, fn) {
    setBusy(id)
    setFailure(null)
    try {
      const r = await fn()
      version.current = ''
      await load()
      return r
    } catch (e) {
      setFailure(e)
    } finally {
      setBusy(null)
    }
  }

  const pick = (id) => {
    setBranchId(id)
    localStorage.setItem(key, id)
  }
  const { waiting, ready } = counterColumns(tickets)
  const usable = state.branches.filter((b) => b.active !== false && b.inPlan !== false)

  return (
    <div className="grid gap-4">
      {usable.length > 1 && (
        <label className="grid max-w-xs gap-1 text-sm">
          {t('pager.page.branch')}
          <select className="min-h-11 rounded-xl border border-line bg-surface px-3" value={branchId ?? ''} onChange={(e) => pick(e.target.value)}>
            {usable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {offline && (
        <p role="status" className="rounded-xl border border-warn/20 bg-warn-bg px-4 py-2 text-sm text-warn">
          {t('pager.page.reconnecting')}
        </p>
      )}
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      <Button
        size="lg"
        className="min-h-16 w-full text-lg sm:w-auto"
        disabled={!branchId}
        loading={busy === 'new'}
        onClick={async () => {
          const made = await run('new', () => api(`/pager/branches/${encodeURIComponent(branchId)}/tickets`, { method: 'POST', body: {} }))
          if (made) setShown(made)
        }}
      >
        + {t('pager.page.newNumber')}
      </Button>
      {shown && (
        <Card>
          <div className="flex flex-wrap items-center gap-6">
            <Qr value={shown.url} size={180} label={t('pager.page.ticketQr', { n: shown.number })} />
            <div>
              <p className="text-sm text-muted">{t('pager.page.number')}</p>
              <p className="tnum text-5xl font-bold">{shown.number}</p>
              <p className="mt-2 max-w-xs text-sm text-muted">{t('pager.page.scanToFollow')}</p>
              <Button className="mt-3" variant="outline" onClick={() => setShown(null)}>
                {t('pager.page.hide')}
              </Button>
            </div>
          </div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Column title={t('pager.page.waiting', { n: waiting.length })}>
          {waiting.map((x) => (
            <TicketCard key={x.id} ticket={x}>
              <Button
                size="lg"
                className="min-h-14 w-full text-base"
                loading={busy === x.id}
                onClick={() => run(x.id, () => api(`/pager/tickets/${x.id}/call`, { method: 'POST', body: {} }))}
              >
                🔔 {t('pager.page.call')}
              </Button>
            </TicketCard>
          ))}
          {!waiting.length && <p className="text-sm text-muted">{t('pager.page.emptyWaiting')}</p>}
        </Column>
        <Column title={t('pager.page.ready', { n: ready.length })}>
          {ready.map((x) => (
            <TicketCard key={x.id} ticket={x}>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="min-h-14"
                  disabled={busy === x.id}
                  onClick={() => run(x.id, () => api(`/pager/tickets/${x.id}/call`, { method: 'POST', body: {} }))}
                >
                  {t('pager.page.recall')}
                </Button>
                <Button
                  className="min-h-14"
                  loading={busy === x.id}
                  onClick={() => run(x.id, () => api(`/pager/tickets/${x.id}/close`, { method: 'POST', body: {} }))}
                >
                  ✓ {t('pager.page.done')}
                </Button>
              </div>
            </TicketCard>
          ))}
          {!ready.length && <p className="text-sm text-muted">{t('pager.page.emptyReady')}</p>}
        </Column>
      </div>
    </div>
  )
}

function Column({ title, children }) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

function TicketCard({ ticket, children }) {
  const { t } = useI18n()
  const since = ticket.status === 'READY' && ticket.readyAt ? ticket.readyAt : ticket.createdAt
  return (
    <article className="mq-card grid gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="tnum text-4xl font-bold leading-none">{ticket.number}</p>
        <p className="text-xs text-muted">{t('pager.page.minutesAgo', { n: minutes(since) })}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ticket.onTheWayAt && <Badge tone="teal">{t('pager.page.onTheWay')}</Badge>}
        {ticket.openedAt && !ticket.onTheWayAt && <Badge tone="blue">{t('pager.page.opened')}</Badge>}
        {(ticket.pushEnabled || ticket.whatsappEnabled) && <Badge tone="green">{t('pager.page.alertOn')}</Badge>}
        {ticket.calls > 1 && <Badge tone="amber">{t('pager.page.calledN', { n: ticket.calls })}</Badge>}
      </div>
      {children}
    </article>
  )
}

/** Owners and managers: counter QR, TV link, branches, settings, brand, reports and the plan. */
/** Owner on the website: what the plan does next (a new renewal price, a Basic still running), and with paid
    Loyalty the one Plus upgrade card. Nothing otherwise. */
function UpgradeFromTab() {
  const { data, reload } = useApi('/billing/pager')
  if (!data) return null
  return (
    <>
      <PagerPlanNotices data={data} />
      {data.included && data.upgrade && <PagerPlusUpgrade offer={data} checkoutHost={data.checkoutHost} onDone={reload} />}
    </>
  )
}

function Manage({ state, reload }) {
  const { t } = useI18n()
  const { can } = useSession()
  const errorText = useErrorText()
  const [failure, setFailure] = useState(null)
  const [saved, setSaved] = useState(null)
  const act = async (fn, okKey) => {
    setFailure(null)
    setSaved(null)
    try {
      await fn()
      if (okKey) setSaved(okKey)
      reload()
    } catch (e) {
      setFailure(e)
    }
  }
  const usable = state.branches.filter((b) => b.active !== false)
  return (
    <div className="grid gap-5">
      {can('owner') && PURCHASES_IN_APP && <UpgradeFromTab />}
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-xl border border-line bg-soft px-4 py-2 text-sm">
          {t('pager.page.saved')}
        </p>
      )}
      <Card title={t('pager.page.counterQr')} subtitle={t('pager.page.counterQrHint')}>
        <div className="grid gap-6 sm:grid-cols-2">
          {usable.map((b) => (
            <div key={b.id} className="print-area grid justify-items-center gap-2 text-center">
              <p className="font-bold">{b.name}</p>
              <Qr value={b.counterUrl} size={200} label={b.name} />
              <p className="text-xs text-muted" dir="ltr">
                {b.counterUrl}
              </p>
            </div>
          ))}
        </div>
        <Button className="no-print mt-4" variant="outline" onClick={() => window.print()}>
          {t('pager.page.print')}
        </Button>
      </Card>
      <CallScreens branches={usable} onError={setFailure} />
      {!canEditBusiness(state) && (
        <p role="note" className="rounded-xl border border-line bg-soft px-4 py-3 text-sm">
          {t('pager.page.managedInPos')}
        </p>
      )}
      <Branches state={state} act={act} />
      <SettingsCard state={state} act={act} />
      {canEditBusiness(state) && <BrandCard state={state} act={act} />}
      <Reports state={state} />
      {can('owner') && PURCHASES_IN_APP && (
        <p className="text-sm">
          {t('pager.page.planLine', { tier: t(`pager.tiers.${state.subscription?.tier ?? state.plan?.tier ?? 'basic'}`) })}{' '}
          <Link to="/app/billing#pager-plan-title" className="font-semibold text-accent underline">
            {t('pager.page.managePlan')}
          </Link>
        </p>
      )}
    </div>
  )
}

function CallScreens({ branches, onError }) {
  const { t } = useI18n()
  const [links, setLinks] = useState({})
  const make = async (id) => {
    try {
      const r = await api(`/pager/branches/${encodeURIComponent(id)}/call-screen`, { method: 'POST', body: {} })
      setLinks((l) => ({ ...l, [id]: r.screen?.url }))
    } catch (e) {
      onError(e)
    }
  }
  return (
    <Card title={t('pager.page.tv')} subtitle={t('pager.page.tvHint')}>
      <ul className="grid gap-3">
        {branches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">{b.name}</span>
            {links[b.id] ? (
              <a href={links[b.id]} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline" dir="ltr">
                {links[b.id]}
              </a>
            ) : (
              <Button variant="outline" onClick={() => make(b.id)}>
                {t('pager.page.makeTvLink')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Branches({ state, act }) {
  const { t } = useI18n()
  const editable = canEditBusiness(state)
  const [name, setName] = useState('')
  const [names, setNames] = useState({})
  const limit = state.plan?.branchLimit ?? state.subscription?.branches ?? null
  const active = state.branches.filter((b) => b.active !== false).length
  const room = limit === null || active < limit
  return (
    <Card title={t('pager.page.branches')} subtitle={limit ? t('pager.page.branchesOf', { n: active, limit }) : undefined}>
      <ul className="grid gap-2">
        {!editable &&
          state.branches.map((b) => (
            <li key={b.id} className="min-h-11 rounded-xl border border-line bg-surface px-3 py-2.5">
              {b.name}
            </li>
          ))}
        {editable &&
          state.branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <input
                className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3"
                aria-label={t('pager.page.branchName')}
                value={names[b.id] ?? b.name}
                maxLength={120}
                onChange={(e) => setNames((n) => ({ ...n, [b.id]: e.target.value }))}
              />
              <Button
                variant="outline"
                disabled={!names[b.id] || names[b.id].trim() === b.name}
                onClick={() => act(() => api(`/pager/branches/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { name: names[b.id].trim() } }), 'saved')}
              >
                {t('pager.page.save')}
              </Button>
              {b.inPlan === false && <Badge tone="gray">{t('pager.page.notInPlan')}</Badge>}
            </li>
          ))}
      </ul>
      {!editable ? null : room ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3"
            placeholder={t('pager.page.newBranch')}
            aria-label={t('pager.page.newBranch')}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            disabled={name.trim().length < 2}
            onClick={() => act(() => api('/pager/branches', { method: 'POST', body: { name: name.trim() } }).then(() => setName('')), 'saved')}
          >
            {t('pager.page.addBranch')}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{t('pager.page.branchLimit')}</p>
      )}
    </Card>
  )
}

function SettingsCard({ state, act }) {
  const { t } = useI18n()
  const [sound, setSound] = useState(state.settings?.sound ?? 'chime')
  const [hours, setHours] = useState(state.settings?.expiryHours ?? 12)
  return (
    <Card title={t('pager.page.settings')}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm">
          {t('pager.page.sound')}
          <select className="min-h-11 rounded-xl border border-line bg-surface px-3" value={sound} onChange={(e) => setSound(e.target.value)}>
            {['chime', 'bell', 'beep'].map((s) => (
              <option key={s} value={s}>
                {t(`pager.page.sounds.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t('pager.page.expiry')}
          <input
            type="number"
            min={1}
            max={48}
            className="tnum min-h-11 w-24 rounded-xl border border-line bg-surface px-3"
            value={hours}
            onChange={(e) => setHours(Math.min(48, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
          />
        </label>
        <Button onClick={() => act(() => api('/pager/settings', { method: 'PUT', body: { sound, expiryHours: hours } }), 'saved')}>
          {t('pager.page.save')}
        </Button>
      </div>
    </Card>
  )
}

/** Name, Arabic name, logo and colours of the customer's waiting page, with a live preview. */
function BrandCard({ state, act }) {
  const { t, locale } = useI18n()
  const b = state.brand ?? {}
  const [form, setForm] = useState({
    name: b.name ?? '',
    nameAr: b.nameAr ?? '',
    logoUrl: b.logoUrl ?? '',
    primaryColor: b.primaryColor ?? '#172740',
    accentColor: b.accentColor ?? '#8AC0C4',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const shownName = locale === 'ar' && form.nameAr ? form.nameAr : form.name
  return (
    <Card title={t('pager.page.brand')} subtitle={t('pager.page.brandHint')}>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-3">
          {['name', 'nameAr', 'logoUrl'].map((k) => (
            <label key={k} className="grid gap-1 text-sm">
              {t(`pager.page.brandFields.${k}`)}
              <input
                className="min-h-11 rounded-xl border border-line bg-surface px-3"
                dir={k === 'logoUrl' ? 'ltr' : undefined}
                value={form[k]}
                maxLength={k === 'logoUrl' ? 2048 : 120}
                onChange={set(k)}
              />
            </label>
          ))}
          <div className="flex gap-4">
            {['primaryColor', 'accentColor'].map((k) => (
              <label key={k} className="grid gap-1 text-sm">
                {t(`pager.page.brandFields.${k}`)}
                <input type="color" className="h-11 w-20 rounded-xl border border-line bg-surface" value={form[k]} onChange={set(k)} />
              </label>
            ))}
          </div>
          <Button className="w-fit" onClick={() => act(() => api('/pager/brand', { method: 'PUT', body: form }), 'saved')}>
            {t('pager.page.save')}
          </Button>
        </div>
        <section
          aria-label={t('pager.page.preview')}
          className="overflow-hidden rounded-3xl border border-line bg-white text-center text-[#172740] shadow-card"
        >
          <div className="grid justify-items-center gap-2 p-5" style={{ background: form.primaryColor, color: '#fff' }}>
            {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-12 w-12 rounded-full bg-white object-contain" /> : null}
            <p className="font-bold">{shownName}</p>
          </div>
          <div className="grid gap-1 p-5">
            <p className="text-xs">{t('pager.page.previewNumber')}</p>
            <p className="tnum text-5xl font-bold">12</p>
            <p className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: form.accentColor }}>
              {t('pager.page.previewStatus')}
            </p>
          </div>
        </section>
      </div>
    </Card>
  )
}

function Reports({ state }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const plus = state.plan?.plusFeatures === true
  const usable = state.branches.filter((b) => b.active !== false)
  const [branchId, setBranchId] = useState(plus ? '' : (usable[0]?.id ?? ''))
  const [report, setReport] = useState(null)
  const [failure, setFailure] = useState(null)
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
  useEffect(() => {
    let alive = true
    setFailure(null)
    api(`/pager/reports?${new URLSearchParams({ from, to, ...(branchId ? { branchId } : {}) })}`)
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setFailure(e))
    return () => {
      alive = false
    }
  }, [branchId, from, to])
  const csv = async () => {
    try {
      const { csv: text, filename } = await api(`/pager/reports/csv?${new URLSearchParams({ from, to, ...(branchId ? { branchId } : {}) })}`)
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setFailure(e)
    }
  }
  const s = report?.summary
  const secs = (v) => (v == null ? '—' : t('pager.page.minutesShort', { n: Math.round(v / 60) }))
  return (
    <Card title={t('pager.page.reports')} subtitle={t('pager.page.last7')}>
      {usable.length > 1 && (
        <select
          className="mb-4 min-h-11 rounded-xl border border-line bg-surface px-3"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label={t('pager.page.branch')}
        >
          {plus && <option value="">{t('pager.page.allBranches')}</option>}
          {usable.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {failure && <p className="text-sm text-err">{errorText(failure)}</p>}
      {s && (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={t('pager.page.stats.tickets')} value={s.tickets} />
          <Stat label={t('pager.page.stats.collected')} value={`${s.collectedPct}%`} />
          <Stat label={t('pager.page.stats.prep')} value={secs(s.avgPrepSeconds)} />
          <Stat label={t('pager.page.stats.wait')} value={secs(s.avgWaitAfterReadySeconds)} />
        </dl>
      )}
      {plus ? (
        <Button className="mt-4" variant="outline" onClick={csv}>
          {t('pager.page.csv')}
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted">{t('pager.page.plusReports')}</p>
      )}
    </Card>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-soft p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-1 text-lg font-bold">{value}</dd>
    </div>
  )
}
