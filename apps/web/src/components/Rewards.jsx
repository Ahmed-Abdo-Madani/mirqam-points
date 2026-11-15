/* Rewards catalogue: what a member can spend points/stamps on.
   Managers keep the list per program; the cashier redeems by picking one instead of typing a number. */

import { Badge, Button, Field, Input, Modal, MqGift, MqPencil, MqPlus, Select, useToast } from '@mirqam/ui'
import { formatMinor, parseMoneyToMinor } from '@mirqam-points/shared'
import { useState } from 'react'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api } from '../lib/api.js'
import { money, num } from '../lib/format.js'
import { unitLabel } from '../lib/programs.js'

export const REWARD_KINDS = ['item', 'percent', 'amount']

/** "Free item", "10% off the bill", "SAR 15.00 off the bill". */
export function rewardDetail(reward, t, locale) {
  if (reward.kind === 'percent') return t('rewards.detail.percent', { n: num(reward.value) })
  if (reward.kind === 'amount') return t('rewards.detail.amount', { amount: money(reward.value, locale) })
  return t('rewards.detail.item')
}

/** Wraps a merchant-typed name in Unicode isolates so an Arabic name reads right inside English copy (and vice versa). */
const FSI = String.fromCharCode(0x2068)
const PDI = String.fromCharCode(0x2069)
export const isolate = (text) => `${FSI}${text}${PDI}`

export const activeRewards = (program) => (program?.rewards ?? []).filter((r) => r.status === 'active')

const emptyForm = { name: '', cost: '', kind: 'item', value: '' }
const toForm = (r) => ({
  name: r.name,
  cost: String(r.cost),
  kind: r.kind,
  value: r.kind === 'amount' ? formatMinor(r.value).replace(/,/g, '') : r.value ? String(r.value) : '',
})

function toBody(form) {
  const value = form.kind === 'item' ? null : form.kind === 'amount' ? parseMoneyToMinor(form.value) : Number.parseInt(form.value, 10)
  return { name: form.name.trim(), cost: Number.parseInt(form.cost, 10), kind: form.kind, value }
}

function formValid(form) {
  const body = toBody(form)
  if (!body.name || !Number.isSafeInteger(body.cost) || body.cost < 1) return false
  if (body.kind === 'item') return true
  if (!Number.isSafeInteger(body.value) || body.value < 1) return false
  return body.kind !== 'percent' || body.value <= 100
}

function RewardForm({ program, reward, onSaved, onCancel }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [form, setForm] = useState(() => (reward ? toForm(reward) : emptyForm))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const path = `/programs/${program.id}/rewards${reward ? `/${reward.id}` : ''}`
      onSaved(await api(path, { method: reward ? 'PATCH' : 'POST', body: toBody(form) }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-soft p-4">
      <Field label={t('rewards.name')}>
        {(p) => <Input {...p} value={form.name} onChange={set('name')} placeholder={t('rewards.namePlaceholder')} maxLength={60} autoFocus />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('rewards.cost', { unit: unitLabel(program.type, t) })}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              dir="ltr"
              value={form.cost}
              onChange={set('cost')}
              placeholder={program.type === 'stamps' ? String(program.config.stampsRequired) : '100'}
            />
          )}
        </Field>
        <Field label={t('rewards.kind')}>
          {(p) => (
            <Select {...p} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, value: '' }))}>
              {REWARD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`rewards.kinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {form.kind !== 'item' && (
        <Field label={t(form.kind === 'percent' ? 'rewards.percent' : 'rewards.amount')}>
          {(p) => (
            <Input
              {...p}
              inputMode={form.kind === 'percent' ? 'numeric' : 'decimal'}
              dir="ltr"
              value={form.value}
              onChange={set('value')}
              placeholder={form.kind === 'percent' ? '10' : '0.00'}
            />
          )}
        </Field>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!formValid(form)}>
          {t(reward ? 'common.save' : 'rewards.add')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

/** Manager view: the program's rewards, add / edit / archive / restore. */
export function RewardsModal({ program, onClose, onChanged }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const [rewards, setRewards] = useState(program.rewards ?? [])
  const [editing, setEditing] = useState(null) // 'new' | reward id
  const unit = unitLabel(program.type, t)

  const upsert = (saved) => {
    setRewards((list) => (list.some((r) => r.id === saved.id) ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]))
    setEditing(null)
    onChanged()
  }

  async function setStatus(reward, status) {
    try {
      upsert(await api(`/programs/${program.id}/rewards/${reward.id}`, { method: 'PATCH', body: { status } }))
      toast(t(status === 'active' ? 'rewards.restored' : 'rewards.archived'))
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t('rewards.title', { program: isolate(program.name) })} closeLabel={t('common.close')}>
      <p className="mb-4 text-sm text-muted">{t('rewards.intro')}</p>
      <ul className="grid gap-2">
        {rewards.map((r) =>
          editing === r.id ? (
            <li key={r.id}>
              <RewardForm program={program} reward={r} onSaved={upsert} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={r.id} className={`flex items-center gap-3 rounded-2xl border border-line p-3 ${r.status === 'archived' ? 'opacity-60' : ''}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-accent">
                <MqGift className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-bold">
                  {r.name}
                </span>
                <span className="block text-xs text-muted">
                  {rewardDetail(r, t, locale)} · <span className="tnum">{num(r.cost)}</span> {unit}
                </span>
              </span>
              {r.status === 'archived' ? (
                <>
                  <Badge tone="amber">{t('rewards.archivedBadge')}</Badge>
                  <Button size="sm" variant="outline" onClick={() => setStatus(r, 'active')}>
                    {t('rewards.restore')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(r.id)} aria-label={t('common.edit')}>
                    <MqPencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'archived')}>
                    {t('rewards.archive')}
                  </Button>
                </>
              )}
            </li>
          ),
        )}
      </ul>
      {!rewards.length && editing !== 'new' && <p className="rounded-2xl bg-soft px-4 py-6 text-center text-sm text-muted">{t('rewards.empty')}</p>}
      <div className="mt-4">
        {editing === 'new' ? (
          <RewardForm program={program} onSaved={upsert} onCancel={() => setEditing(null)} />
        ) : (
          <Button variant="outline" onClick={() => setEditing('new')}>
            <MqPlus className="h-4 w-4" />
            {t('rewards.add')}
          </Button>
        )}
      </div>
    </Modal>
  )
}

/** − n + counter with large touch targets. */
export function Stepper({ value, min = 1, max, onChange, label }) {
  const btn = 'flex h-12 w-12 items-center justify-center rounded-xl text-2xl font-bold text-ink transition hover:bg-tint disabled:opacity-30'
  return (
    <fieldset className="inline-flex items-center gap-1 rounded-2xl border border-line bg-surface p-1">
      <legend className="sr-only">{label}</legend>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="−">
        −
      </button>
      <span className="tnum min-w-10 text-center text-xl font-bold" aria-live="polite">
        {num(value)}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={max != null && value >= max} aria-label="+">
        +
      </button>
    </fieldset>
  )
}

/** Cashier: pick a reward the balance covers, then how many. */
export function RewardPicker({ program, balance, selected, quantity, onSelect, onQuantity }) {
  const { t, locale } = useI18n()
  const unit = unitLabel(program.type, t)
  const chosen = activeRewards(program).find((r) => r.id === selected)
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2" aria-label={t('rewards.pick')}>
        {activeRewards(program).map((r) => {
          const affordable = Math.floor(balance / r.cost)
          const on = r.id === selected
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!affordable}
                onClick={() => {
                  onSelect(r.id)
                  onQuantity(1)
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-brand-500 bg-tint' : 'border-line hover:border-brand-500/50'}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-soft text-accent">
                  <MqGift className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate font-bold">
                    {r.name}
                  </span>
                  <span className="block text-xs text-muted">{rewardDetail(r, t, locale)}</span>
                </span>
                <span className="text-end">
                  <span className="tnum block font-bold">
                    {num(r.cost)} {unit}
                  </span>
                  <span className="block text-xs text-muted">{affordable ? t('rewards.canRedeem', { n: num(affordable) }) : t('rewards.notEnough')}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {chosen && Math.floor(balance / chosen.cost) > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">{t('rewards.quantity')}</span>
          <Stepper value={quantity} max={Math.floor(balance / chosen.cost)} onChange={onQuantity} label={t('rewards.quantity')} />
        </div>
      )}
    </div>
  )
}
