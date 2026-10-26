import { Badge, Button, Card, EmptyState, Field, Input, Modal, MqCoins, MqPencil, MqPlus, MqQrCode, MqStamp, Skeleton, useToast } from '@mirqam/ui'
import { computeEarn, DEFAULT_CONFIG, formatMinor, normalizeDesign, parseMoneyToMinor, validateProgramConfig } from '@mirqam-points/shared'
import { useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import Qr from '../../components/Qr.jsx'
import { downloadJoinPoster } from '../../lib/joinPoster.js'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, publicOrigin, useApi } from '../../lib/api.js'
import { money, num } from '../../lib/format.js'
import { ruleSummary, statusTone, unitLabel } from '../../lib/programs.js'
import { useSession } from '../../lib/session.jsx'
import { CardDesignForm, CardPreview } from './CardDesign.jsx'
import { CopyButton } from './GiftCards.jsx'

/* Form state keeps money as SAR strings; converted to halalas only on submit. */
function toForm(program) {
  const type = program?.type ?? 'points'
  const c = { ...DEFAULT_CONFIG[type], ...(program?.config ?? {}) }
  return {
    name: program?.name ?? '',
    type,
    pointsPerUnit: String(c.pointsPerUnit ?? 1),
    unit: formatMinor(c.unitMinor ?? 100).replace(/,/g, ''),
    stampsPerVisit: String(c.stampsPerVisit ?? 1),
    stampsRequired: String(c.stampsRequired ?? 10),
    minPurchase: c.minPurchaseMinor ? formatMinor(c.minPurchaseMinor).replace(/,/g, '') : '',
    design: normalizeDesign(program?.design),
    selfEnroll: program?.selfEnroll ?? false,
  }
}

// A points program has no stamps to draw, so it never keeps the stamp-strip layout.
const designOf = (form) => ({
  ...form.design,
  ...(form.type !== 'stamps' && form.design.layout === 'strip' ? { layout: 'classic' } : {}),
  rewardText: (form.design.rewardText ?? '').trim(),
})

function toConfig(form) {
  const minPurchaseMinor = form.minPurchase.trim() ? parseMoneyToMinor(form.minPurchase) : 0
  if (form.type === 'stamps') {
    return { stampsPerVisit: Number(form.stampsPerVisit), stampsRequired: Number(form.stampsRequired), minPurchaseMinor }
  }
  return { pointsPerUnit: Number(form.pointsPerUnit), unitMinor: parseMoneyToMinor(form.unit), minPurchaseMinor }
}

function ProgramModal({ open, onClose, program, onSaved }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { me } = useSession()
  const [form, setForm] = useState(() => toForm(program))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('program')
  const [side, setSide] = useState('front')
  const editing = Boolean(program)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const config = toConfig(form)
  const sample = 10_000 // 100 SAR preview purchase
  const valid = validateProgramConfig(form.type, config)
  const preview = valid.ok ? computeEarn(form.type, valid.config, sample) : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = editing
        ? await api(`/programs/${program.id}`, { method: 'PATCH', body: { name: form.name, config, design: designOf(form), selfEnroll: form.selfEnroll } })
        : await api('/programs', { method: 'POST', body: { name: form.name, type: form.type, config, design: designOf(form), selfEnroll: form.selfEnroll } })
      toast(t(editing ? 'programs.saved' : 'programs.created'))
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const typeButton = (type, Icon) => (
    <button
      type="button"
      disabled={editing}
      aria-pressed={form.type === type}
      onClick={() => setForm((f) => ({ ...f, ...toForm({ type, design: designOf(f), selfEnroll: f.selfEnroll }), name: f.name }))}
      className={`flex flex-1 items-start gap-3 rounded-2xl border p-4 text-start transition disabled:cursor-not-allowed ${form.type === type ? 'border-brand-500 bg-tint' : 'border-line hover:border-brand-500/50'}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <span>
        <span className="block text-sm font-bold">{t(`programs.type.${type}`)}</span>
        <span className="mt-0.5 block text-xs text-muted">{t(`programs.typeHint.${type}`)}</span>
      </span>
    </button>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={t(editing ? 'programs.edit' : 'programs.new')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.name.trim()}>
            {t(editing ? 'common.save' : 'programs.create')}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {['program', 'card'].map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${tab === k ? 'border-brand-500 text-accent' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t(k === 'program' ? 'design.tabProgram' : 'design.tabCard')}
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-4">
          {tab === 'card' && <CardDesignForm design={form.design} type={form.type} onChange={(design) => setForm((f) => ({ ...f, design }))} />}
          <div className={tab === 'card' ? 'hidden' : 'contents'}>
            <Field label={t('programs.name')}>
              {(p) => <Input {...p} value={form.name} onChange={set('name')} placeholder={t('programs.namePlaceholder')} maxLength={80} />}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">{t('programs.typeLabel')}</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                {typeButton('points', MqCoins)}
                {typeButton('stamps', MqStamp)}
              </div>
              {editing && <p className="mt-1 text-xs text-muted">{t('programs.typeLocked')}</p>}
            </fieldset>
            {form.type === 'points' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('programs.pointsPerUnit')}>
                  {(p) => <Input {...p} inputMode="numeric" dir="ltr" value={form.pointsPerUnit} onChange={set('pointsPerUnit')} />}
                </Field>
                <Field label={t('programs.unit')} hint={t('programs.unitHint')}>
                  {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={form.unit} onChange={set('unit')} />}
                </Field>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('programs.stampsPerVisit')}>
                  {(p) => <Input {...p} inputMode="numeric" dir="ltr" value={form.stampsPerVisit} onChange={set('stampsPerVisit')} />}
                </Field>
                <Field label={t('programs.stampsRequired')} hint={t('programs.stampsRequiredHint')}>
                  {(p) => <Input {...p} inputMode="numeric" dir="ltr" value={form.stampsRequired} onChange={set('stampsRequired')} />}
                </Field>
              </div>
            )}
            <Field label={t('programs.minPurchase')} hint={t('programs.minPurchaseHint')}>
              {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={form.minPurchase} onChange={set('minPurchase')} placeholder="0.00" />}
            </Field>
            <p className="rounded-2xl bg-tint px-4 py-3 text-sm">
              {t('programs.preview', { amount: money(sample, locale), n: num(preview), unit: unitLabel(form.type, t) })}
            </p>
            <label className="flex items-start gap-3 rounded-2xl border border-line p-4 text-sm">
              <input
                type="checkbox"
                checked={form.selfEnroll}
                onChange={(e) => setForm((f) => ({ ...f, selfEnroll: e.target.checked }))}
                className="mt-1 h-4 w-4 accent-brand-600"
              />
              <span>
                <span className="block font-semibold">{t('programs.selfEnroll')}</span>
                <span className="mt-0.5 block text-xs text-muted">{t('programs.selfEnrollHint')}</span>
              </span>
            </label>
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
              {errorText(error)}
            </p>
          )}
        </div>
        <div className="hidden md:block">
          <CardPreview
            side={side}
            onSide={setSide}
            merchant={me.tenant.name}
            logoUrl={me.tenant.logoUrl}
            programName={form.name || t('programs.namePlaceholder')}
            type={form.type}
            stampsRequired={Math.min(Number(form.stampsRequired) || 10, 20)}
            memberName={t('landing.demoMember')}
            design={designOf(form)}
          />
        </div>
      </div>
    </Modal>
  )
}

export default function Programs() {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { can } = useSession()
  const { data, loading, reload } = useApi('/programs')
  const [modal, setModal] = useState(null) // { program?: object }
  const [poster, setPoster] = useState(null)
  const { me } = useSession()

  async function setStatus(program, status) {
    try {
      await api(`/programs/${program.id}`, { method: 'PATCH', body: { status } })
      toast(t(`programs.status.${status}Done`))
      reload()
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  return (
    <>
      <PageHeader
        title={t('nav.programs')}
        subtitle={t('programs.subtitle')}
        actions={
          can('manage') && (
            <Button onClick={() => setModal({})}>
              <MqPlus className="h-4 w-4" />
              {t('programs.new')}
            </Button>
          )
        }
      />
      {loading && !data ? (
        <Skeleton rows={2} />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={MqCoins}
            title={t('programs.emptyTitle')}
            desc={t('programs.emptyBody')}
            action={can('manage') && <Button onClick={() => setModal({})}>{t('programs.new')}</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => (
            <article key={p.id} className="mq-card flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-tint text-accent">
                  {p.type === 'stamps' ? <MqStamp className="h-5 w-5" /> : <MqCoins className="h-5 w-5" />}
                </span>
                <Badge tone={statusTone[p.status]}>{t(`programs.status.${p.status}`)}</Badge>
              </div>
              <h2 className="mt-4 text-lg font-bold">{p.name}</h2>
              <p className="mt-1 text-sm text-muted">{ruleSummary(p, t, locale)}</p>
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                <div>
                  <dt className="text-xs text-muted">{t('programs.members')}</dt>
                  <dd className="tnum mt-0.5 font-bold">{num(p.members)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('programs.outstanding')}</dt>
                  <dd className="tnum mt-0.5 font-bold">{num(p.outstanding)}</dd>
                </div>
              </dl>
              {can('manage') && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {p.selfEnroll && p.status === 'active' && (
                    <Button variant="outline" size="sm" onClick={() => setPoster(p)}>
                      <MqQrCode className="h-4 w-4" />
                      {t('programs.joinPoster')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setModal({ program: p })}>
                    <MqPencil className="h-4 w-4" />
                    {t('common.edit')}
                  </Button>
                  {p.status !== 'active' ? (
                    <Button size="sm" onClick={() => setStatus(p, 'active')}>
                      {t('programs.activate')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setStatus(p, 'archived')}>
                      {t('programs.archive')}
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {poster && (
        <Modal open onClose={() => setPoster(null)} title={t('programs.joinPoster')} closeLabel={t('common.close')}>
          <div className="grid justify-items-center gap-4 text-center">
            <p className="text-lg font-bold">{t('join.title', { program: poster.name })}</p>
            <Qr value={`${publicOrigin()}/join/${me.tenant.slug}/${poster.id}`} size={220} label={t('programs.joinPoster')} />
            <p className="text-sm text-muted">{t('programs.joinPosterHint')}</p>
            <div className="flex gap-2">
              <CopyButton value={`${publicOrigin()}/join/${me.tenant.slug}/${poster.id}`} />
              <Button
                size="sm"
                onClick={() => {
                  const d = normalizeDesign(poster.design)
                  downloadJoinPoster({
                    url: `${publicOrigin()}/join/${me.tenant.slug}/${poster.id}`,
                    merchant: me.tenant.name || poster.name,
                    programName: poster.name,
                    scanText: t('programs.posterScan'),
                    colors: { background: d.background, foreground: d.foreground, label: d.label },
                    fileName: `join-${poster.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'qr'}.png`,
                  }).catch(() => toast(t('errors.generic'), 'err'))
                }}
              >
                {t('programs.downloadPoster')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal && <ProgramModal open onClose={() => setModal(null)} program={modal.program} onSaved={reload} />}
    </>
  )
}
