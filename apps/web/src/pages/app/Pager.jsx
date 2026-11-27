import { Badge, Button, Card, Modal, Skeleton } from '@mirqam/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/AppShell.jsx'
import { PagerFinePrint, PagerPlanCards } from '../../components/PagerPlans.jsx'
import Qr from '../../components/Qr.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { amountMinor, canEditBusiness, counterColumns, counterFigures, lastClosed, pagerPageState, pickBranch, riyadhDay } from '../../lib/pager-page.js'
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

  // While the first activation reaches the POS, look again every few seconds.
  useEffect(() => {
    if (state !== 'starting') return undefined
    const timer = setInterval(reload, 4000)
    return () => clearInterval(timer)
  }, [state, reload])

  return (
    <>
      <PageHeader title={t('pager.page.title')} subtitle={t('pager.page.subtitle')} />
      {state === 'loading' && <Skeleton rows={3} />}
      {state === 'unavailable' && <Unavailable onRetry={reload} />}
      {state === 'starting' && (
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
      <Card>
        <p className="text-sm leading-relaxed">{t('pager.page.noPlan')}</p>
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
            withLoyalty={plan?.withLoyalty}
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
          {/* The yearly rule only where yearly is offered (never for the with-Loyalty price). */}
          <PagerFinePrint yearly={(plan?.cycles ?? ['monthly', 'yearly']).includes('yearly')} />
        </>
      )}
    </div>
  )
}

/** Prints one QR on its own page (a new window, so the console around it is not printed). */
async function printQr(url, title) {
  const w = window.open('', '_blank', 'width=480,height=640')
  if (!w) return
  const { default: QRCode } = await import('qrcode')
  const src = await QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: 'M' })
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  w.document.write(
    `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:sans-serif;text-align:center"><div><h1 style="font-size:22px">${esc(title)}</h1><img src="${src}" width="320" height="320" alt=""><p style="font-size:12px;direction:ltr">${esc(url)}</p></div></body></html>`,
  )
  w.document.close()
  w.focus()
  w.print()
}

/** The counter a cashier keeps open all day: the form and live figures on one row, a dense board, a side rail. */
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
  const [number, setNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [screen, setScreen] = useState(null)
  const numberRef = useRef(null)
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

  // The branch's TV link, for the rail (read only; made in Setup).
  useEffect(() => {
    if (!branchId) return undefined
    let alive = true
    setScreen(null)
    api(`/pager/branches/${encodeURIComponent(branchId)}/call-screen`)
      .then((r) => alive && setScreen(r.screen?.url ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [branchId])

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

  async function add(e) {
    e.preventDefault()
    const minor = amountMinor(amount)
    if (Number.isNaN(minor)) return setFailure({ code: 'validation_failed' })
    const body = { ...(number.trim() ? { number: number.trim() } : {}), ...(minor !== undefined ? { amountMinor: minor } : {}) }
    const made = await run('new', () => api(`/pager/branches/${encodeURIComponent(branchId)}/tickets`, { method: 'POST', body }))
    if (made) {
      setShown(made)
      setNumber('')
      setAmount('')
    }
    numberRef.current?.focus()
  }

  const pick = (id) => {
    setBranchId(id)
    localStorage.setItem(key, id)
  }
  const { waiting, ready } = counterColumns(tickets)
  const figures = counterFigures(tickets)
  const closed = lastClosed(tickets)
  const usable = state.branches.filter((b) => b.active !== false && b.inPlan !== false)
  const branch = usable.find((b) => b.id === branchId)
  const call = (x) => run(x.id, () => api(`/pager/tickets/${x.id}/call`, { method: 'POST', body: {} }))
  const close = (x) => run(x.id, () => api(`/pager/tickets/${x.id}/close`, { method: 'POST', body: {} }))
  const input = 'min-h-11 rounded-xl border border-line bg-surface px-3 text-sm'

  return (
    <div className="grid gap-3">
      {/* Top row: branch, the new-number form (Enter adds; the cursor returns to the number), live figures. */}
      <div className="mq-card flex flex-wrap items-end gap-3 p-3">
        {usable.length > 1 && (
          <label className="grid gap-1 text-xs text-muted">
            {t('pager.page.branch')}
            <select className={input} value={branchId ?? ''} onChange={(e) => pick(e.target.value)}>
              {usable.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <form onSubmit={add} className="flex flex-1 flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted">
            {t('pager.page.number')}
            <input
              ref={numberRef}
              className={`${input} tnum w-28`}
              inputMode="numeric"
              maxLength={6}
              placeholder={t('pager.page.auto')}
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^\d٠-٩]/g, ''))}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            {t('pager.page.amount')}
            <input
              className={`${input} tnum w-28`}
              inputMode="decimal"
              placeholder={t('pager.page.optional')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <Button type="submit" className="min-h-11 px-6" disabled={!branchId} loading={busy === 'new'}>
            + {t('pager.page.add')}
          </Button>
        </form>
        <dl className="flex gap-2 text-center">
          <Figure label={t('pager.page.figPreparing')} value={figures.preparing} />
          <Figure label={t('pager.page.figReady')} value={figures.ready} />
          <Figure label={t('pager.page.figWait')} value={figures.avgWaitMinutes == null ? '—' : t('pager.page.minutesShort', { n: figures.avgWaitMinutes })} />
        </dl>
      </div>

      {offline && (
        <p role="status" className="rounded-xl border border-warn/20 bg-warn-bg px-4 py-2 text-sm text-warn">
          {t('pager.page.reconnecting')}
        </p>
      )}
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-2 text-sm text-err">
          {errorText(failure)}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        {/* Board: on a phone Ready comes first (the numbers to hand out), then Preparing. */}
        <div className="mq-card grid gap-4 p-3 lg:grid-cols-2">
          {!waiting.length && !ready.length ? (
            <p className="text-sm text-muted lg:col-span-2">{t('pager.page.emptyBoard')}</p>
          ) : (
            <>
              <Column className="order-2 lg:order-1" title={t('pager.page.waiting', { n: waiting.length })}>
                {waiting.map((x) => (
                  <TicketCard key={x.id} ticket={x}>
                    <Button className="min-h-11 w-full" loading={busy === x.id} onClick={() => call(x)}>
                      🔔 {t('pager.page.call')}
                    </Button>
                  </TicketCard>
                ))}
              </Column>
              <Column className="order-1 lg:order-2" title={t('pager.page.ready', { n: ready.length })}>
                {ready.map((x) => (
                  <TicketCard key={x.id} ticket={x}>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button variant="outline" className="min-h-11 px-2" disabled={busy === x.id} onClick={() => call(x)}>
                        {t('pager.page.recall')}
                      </Button>
                      <Button className="min-h-11 px-2" loading={busy === x.id} onClick={() => close(x)}>
                        ✓ {t('pager.page.done')}
                      </Button>
                    </div>
                  </TicketCard>
                ))}
              </Column>
            </>
          )}
        </div>

        {/* Side rail: the branch's counter QR, the TV link, the last closed numbers. On a phone: two buttons. */}
        <aside className="grid content-start gap-3">
          <div className="mq-card hidden gap-2 p-3 text-center lg:grid">
            {branch && <Qr value={branch.counterUrl} size={150} label={t('pager.page.counterQr')} className="mx-auto" />}
            <p className="text-xs text-muted">{t('pager.page.counterQrHint')}</p>
            {branch && (
              <Button variant="outline" className="min-h-10" onClick={() => printQr(branch.counterUrl, branch.name)}>
                {t('pager.page.print')}
              </Button>
            )}
            {screen && (
              <a href={screen} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent underline">
                {t('pager.page.openTv')}
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            <Button variant="outline" className="min-h-11" disabled={!branch} onClick={() => setQrOpen(true)}>
              {t('pager.page.counterQr')}
            </Button>
            {screen ? (
              <a
                href={screen}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line text-sm font-semibold"
              >
                {t('pager.page.openTv')}
              </a>
            ) : (
              <Button variant="outline" className="min-h-11" disabled>
                {t('pager.page.openTv')}
              </Button>
            )}
          </div>
          {closed.length > 0 && (
            <div className="mq-card hidden p-3 lg:block">
              <p className="mb-2 text-xs font-semibold text-muted">{t('pager.page.lastClosed')}</p>
              <p className="tnum flex flex-wrap gap-1.5 text-sm font-bold">
                {closed.map((x) => (
                  <span key={x.id} className="rounded-lg bg-soft px-2 py-1">
                    {x.number}
                  </span>
                ))}
              </p>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(shown)}
        onClose={() => setShown(null)}
        title={shown ? t('pager.page.ticketQr', { n: shown.number }) : ''}
        closeLabel={t('pager.page.hide')}
      >
        {shown && (
          <div className="grid justify-items-center gap-2 text-center">
            <p className="tnum text-6xl font-bold">{shown.number}</p>
            <Qr value={shown.url} size={220} label={t('pager.page.ticketQr', { n: shown.number })} />
            <p className="max-w-xs text-sm text-muted">{t('pager.page.scanToFollow')}</p>
          </div>
        )}
      </Modal>
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title={branch?.name ?? ''} closeLabel={t('pager.page.hide')}>
        {branch && (
          <div className="grid justify-items-center gap-3 text-center">
            <Qr value={branch.counterUrl} size={240} label={t('pager.page.counterQr')} />
            <p className="text-sm text-muted">{t('pager.page.counterQrHint')}</p>
            <Button variant="outline" onClick={() => printQr(branch.counterUrl, branch.name)}>
              {t('pager.page.print')}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Figure({ label, value }) {
  return (
    <div className="min-w-[72px] rounded-xl bg-soft px-3 py-1.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="tnum text-lg font-bold leading-tight">{value}</dd>
    </div>
  )
}

function Column({ title, className = '', children }) {
  return (
    <section className={`grid content-start gap-2 ${className}`}>
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">{children}</div>
    </section>
  )
}

function TicketCard({ ticket, children }) {
  const { t } = useI18n()
  const since = ticket.status === 'READY' && ticket.readyAt ? ticket.readyAt : ticket.createdAt
  return (
    <article className="grid gap-2 rounded-xl border border-line bg-surface p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="tnum text-3xl font-bold leading-none">{ticket.number}</p>
        <p className="text-[11px] text-muted">{t('pager.page.minutesAgo', { n: minutes(since) })}</p>
      </div>
      {(ticket.onTheWayAt || ticket.openedAt || ticket.pushEnabled || ticket.whatsappEnabled || ticket.calls > 1) && (
        <div className="flex flex-wrap gap-1">
          {ticket.onTheWayAt && <Badge tone="teal">{t('pager.page.onTheWay')}</Badge>}
          {ticket.openedAt && !ticket.onTheWayAt && <Badge tone="blue">{t('pager.page.opened')}</Badge>}
          {(ticket.pushEnabled || ticket.whatsappEnabled) && <Badge tone="green">{t('pager.page.alertOn')}</Badge>}
          {ticket.calls > 1 && <Badge tone="amber">{t('pager.page.calledN', { n: ticket.calls })}</Badge>}
        </div>
      )}
      {children}
    </article>
  )
}

/** Owners and managers: the report figures on top, then branches (QR, TV link) and settings beside the customer-page look. */
function Manage({ state, reload }) {
  const { t } = useI18n()
  const { can } = useSession()
  const errorText = useErrorText()
  const [failure, setFailure] = useState(null)
  const [saved, setSaved] = useState(false)
  const act = async (fn) => {
    setFailure(null)
    setSaved(false)
    try {
      await fn()
      setSaved(true)
      reload()
    } catch (e) {
      setFailure(e)
    }
  }
  const editable = canEditBusiness(state)
  return (
    <div className="grid gap-4">
      <Reports state={state} />
      {failure && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-2 text-sm text-err">
          {errorText(failure)}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-xl border border-line bg-soft px-4 py-2 text-sm">
          {t('pager.page.saved')}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <div className="grid gap-4 lg:col-span-7">
          <Branches state={state} act={act} onError={setFailure} />
          {can('owner') && PURCHASES_IN_APP && (
            <p className="text-sm">
              {t('pager.page.planLine', { tier: t(`pager.tiers.${state.subscription?.tier ?? state.plan?.tier ?? 'basic'}`) })}{' '}
              <Link to="/app/billing#pager-plan-title" className="font-semibold text-accent underline">
                {t('pager.page.managePlan')}
              </Link>
            </p>
          )}
        </div>
        <div className="lg:sticky lg:top-24 lg:col-span-5">
          {editable ? (
            <BrandCard state={state} act={act} />
          ) : (
            <p role="note" className="rounded-xl border border-line bg-soft px-4 py-3 text-sm">
              {t('pager.page.managedInPos')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** One table for the branches: name, counter QR, TV link (and a column kept for the loyalty-programme picker),
    with Add branch and the plan's limit in its header and the counter settings in one row under it. */
function Branches({ state, act, onError }) {
  const { t } = useI18n()
  const editable = canEditBusiness(state)
  const [name, setName] = useState('')
  const [names, setNames] = useState({})
  const [links, setLinks] = useState({})
  const [qr, setQr] = useState(null)
  const [copied, setCopied] = useState(null)
  const active = state.branches.filter((b) => b.active !== false)
  const limit = state.plan?.branchLimit ?? state.subscription?.branches ?? null
  const room = limit === null || active.length < limit

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per branch list (active is derived from it).
  useEffect(() => {
    let alive = true
    for (const b of active)
      api(`/pager/branches/${encodeURIComponent(b.id)}/call-screen`)
        .then((r) => alive && setLinks((l) => ({ ...l, [b.id]: r.screen?.url ?? null })))
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [state.branches])

  const makeLink = async (id) => {
    try {
      const r = await api(`/pager/branches/${encodeURIComponent(id)}/call-screen`, { method: 'POST', body: {} })
      setLinks((l) => ({ ...l, [id]: r.screen?.url ?? null }))
    } catch (e) {
      onError(e)
    }
  }
  const copy = async (id, url) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
    } catch {}
  }
  const input = 'min-h-10 rounded-xl border border-line bg-surface px-3 text-sm'

  return (
    <section className="mq-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold">{t('pager.page.branches')}</h2>
          {limit && <p className="text-xs text-muted">{t('pager.page.branchesOf', { n: active.length, limit })}</p>}
        </div>
        {editable && room && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim().length >= 2) act(() => api('/pager/branches', { method: 'POST', body: { name: name.trim() } }).then(() => setName('')))
            }}
          >
            <input
              className={`${input} w-40`}
              placeholder={t('pager.page.newBranch')}
              aria-label={t('pager.page.newBranch')}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" className="min-h-10" disabled={name.trim().length < 2}>
              {t('pager.page.addBranch')}
            </Button>
          </form>
        )}
        {editable && !room && <p className="text-xs text-muted">{t('pager.page.branchLimit')}</p>}
      </header>

      <div className="hidden grid-cols-[minmax(0,1fr)_64px_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3 border-b border-line bg-soft px-4 py-2 text-xs font-semibold text-muted sm:grid">
        <span>{t('pager.page.branchName')}</span>
        <span>{t('pager.page.qr')}</span>
        <span>{t('pager.page.tv')}</span>
        {/* Kept for the loyalty-programme picker (another PR). */}
        <span />
      </div>
      <ul>
        {state.branches.map((b) => (
          <li
            key={b.id}
            className="grid items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_64px_minmax(0,1.2fr)_minmax(0,0.8fr)]"
          >
            <div className="flex items-center gap-2">
              {editable ? (
                <>
                  <input
                    className={`${input} min-w-0 flex-1`}
                    aria-label={t('pager.page.branchName')}
                    value={names[b.id] ?? b.name}
                    maxLength={120}
                    onChange={(e) => setNames((n) => ({ ...n, [b.id]: e.target.value }))}
                  />
                  {names[b.id] && names[b.id].trim() !== b.name && (
                    <Button
                      variant="outline"
                      className="min-h-10"
                      onClick={() => act(() => api(`/pager/branches/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { name: names[b.id].trim() } }))}
                    >
                      {t('pager.page.save')}
                    </Button>
                  )}
                </>
              ) : (
                <span className="font-semibold">{b.name}</span>
              )}
              {b.inPlan === false && <Badge tone="gray">{t('pager.page.notInPlan')}</Badge>}
            </div>
            <button
              type="button"
              className="w-fit rounded-lg border border-line p-0.5"
              onClick={() => setQr(b)}
              aria-label={t('pager.page.enlargeQr', { name: b.name })}
            >
              <Qr value={b.counterUrl} size={52} label="" />
            </button>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {links[b.id] ? (
                <>
                  <a href={links[b.id]} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
                    {t('pager.page.openTv')}
                  </a>
                  <button type="button" className="text-muted underline" onClick={() => copy(b.id, links[b.id])}>
                    {copied === b.id ? t('pager.page.copied') : t('pager.page.copy')}
                  </button>
                </>
              ) : (
                <Button variant="outline" className="min-h-10" onClick={() => makeLink(b.id)}>
                  {t('pager.page.makeTvLink')}
                </Button>
              )}
            </div>
            <span aria-hidden="true" className="hidden sm:block" />
          </li>
        ))}
      </ul>

      <SettingsRow state={state} act={act} />

      <Modal open={Boolean(qr)} onClose={() => setQr(null)} title={qr?.name ?? ''} closeLabel={t('pager.page.hide')}>
        {qr && (
          <div className="grid justify-items-center gap-3 text-center">
            <Qr value={qr.counterUrl} size={240} label={t('pager.page.counterQr')} />
            <p className="text-sm text-muted">{t('pager.page.counterQrHint')}</p>
            <p className="text-xs text-muted" dir="ltr">
              {qr.counterUrl}
            </p>
            <Button variant="outline" onClick={() => printQr(qr.counterUrl, qr.name)}>
              {t('pager.page.print')}
            </Button>
          </div>
        )}
      </Modal>
    </section>
  )
}

function SettingsRow({ state, act }) {
  const { t } = useI18n()
  const [sound, setSound] = useState(state.settings?.sound ?? 'chime')
  const [hours, setHours] = useState(state.settings?.expiryHours ?? 12)
  const input = 'min-h-10 rounded-xl border border-line bg-surface px-3 text-sm'
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-line bg-soft/50 px-4 py-3">
      <p className="w-full text-xs font-semibold text-muted sm:w-auto sm:self-center">{t('pager.page.settings')}</p>
      <label className="grid gap-1 text-xs text-muted">
        {t('pager.page.sound')}
        <select className={input} value={sound} onChange={(e) => setSound(e.target.value)}>
          {['chime', 'bell', 'beep'].map((s) => (
            <option key={s} value={s}>
              {t(`pager.page.sounds.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        {t('pager.page.expiry')}
        <input
          type="number"
          min={1}
          max={48}
          className={`${input} tnum w-20`}
          value={hours}
          onChange={(e) => setHours(Math.min(48, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
        />
      </label>
      <Button className="min-h-10" onClick={() => act(() => api('/pager/settings', { method: 'PUT', body: { sound, expiryHours: hours } }))}>
        {t('pager.page.save')}
      </Button>
    </div>
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
  const input = 'min-h-10 rounded-xl border border-line bg-surface px-3 text-sm'
  return (
    <section className="mq-card grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_160px]">
      <div className="grid min-w-0 content-start gap-2.5">
        <div>
          <h2 className="text-[15px] font-bold">{t('pager.page.brand')}</h2>
          <p className="text-xs text-muted">{t('pager.page.brandHint')}</p>
        </div>
        {['name', 'nameAr', 'logoUrl'].map((k) => (
          <label key={k} className="grid min-w-0 gap-1 text-xs text-muted">
            {t(`pager.page.brandFields.${k}`)}
            <input
              className={`${input} w-full min-w-0`}
              dir={k === 'logoUrl' ? 'ltr' : undefined}
              value={form[k]}
              maxLength={k === 'logoUrl' ? 2048 : 120}
              onChange={set(k)}
            />
          </label>
        ))}
        <div className="flex items-end gap-3">
          {['primaryColor', 'accentColor'].map((k) => (
            <label key={k} className="grid gap-1 text-xs text-muted">
              {t(`pager.page.brandFields.${k}`)}
              <input type="color" className="h-10 w-16 rounded-xl border border-line bg-surface" value={form[k]} onChange={set(k)} />
            </label>
          ))}
          <Button className="min-h-10" onClick={() => act(() => api('/pager/brand', { method: 'PUT', body: form }))}>
            {t('pager.page.save')}
          </Button>
        </div>
      </div>
      <section
        aria-label={t('pager.page.preview')}
        className="h-fit overflow-hidden rounded-3xl border border-line bg-white text-center text-[#172740] shadow-card"
      >
        <div className="grid justify-items-center gap-1.5 p-4" style={{ background: form.primaryColor, color: '#fff' }}>
          {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-10 w-10 rounded-full bg-white object-contain" /> : null}
          <p className="text-sm font-bold">{shownName}</p>
        </div>
        <div className="grid gap-1 p-4">
          <p className="text-[11px]">{t('pager.page.previewNumber')}</p>
          <p className="tnum text-4xl font-bold">12</p>
          <p className="mt-1 inline-block rounded-full px-3 py-1 text-[11px] font-semibold text-white" style={{ background: form.accentColor }}>
            {t('pager.page.previewStatus')}
          </p>
        </div>
      </section>
    </section>
  )
}

/** The report as a strip of four figures (last 7 days), with the Plus note or CSV under it. */
function Reports({ state }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const plus = state.plan?.plusFeatures === true
  const usable = state.branches.filter((b) => b.active !== false)
  const [branchId, setBranchId] = useState(plus ? '' : (usable[0]?.id ?? ''))
  const [report, setReport] = useState(null)
  const [failure, setFailure] = useState(null)
  // Riyadh days, as the POS counts them (a UTC date missed today's numbers after 21:00 UTC).
  const to = riyadhDay()
  const from = riyadhDay(new Date(Date.now() - 6 * 86_400_000))
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
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">
          {t('pager.page.reports')} <span className="text-xs font-normal text-muted">· {t('pager.page.last7')}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {usable.length > 1 && (
            <select
              className="min-h-10 rounded-xl border border-line bg-surface px-3 text-sm"
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
          {plus && (
            <Button variant="outline" className="min-h-10" onClick={csv}>
              {t('pager.page.csv')}
            </Button>
          )}
        </div>
      </div>
      {failure && <p className="text-sm text-err">{errorText(failure)}</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('pager.page.stats.tickets')} value={s ? s.tickets : '—'} />
        <Stat label={t('pager.page.stats.collected')} value={s ? `${s.collectedPct}%` : '—'} />
        <Stat label={t('pager.page.stats.prep')} value={s ? secs(s.avgPrepSeconds) : '—'} />
        <Stat label={t('pager.page.stats.wait')} value={s ? secs(s.avgWaitAfterReadySeconds) : '—'} />
      </dl>
      {!plus && <p className="text-xs text-muted">{t('pager.page.plusReports')}</p>}
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div className="mq-card px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-bold">{value}</dd>
    </div>
  )
}
