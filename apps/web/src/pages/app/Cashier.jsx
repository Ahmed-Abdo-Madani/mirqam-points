/* Counter flow: phone → (enroll if new) → earn or redeem → confirmation.
   Large targets, one decision per screen. The camera scanner and offline
   queue arrive with the cashier PWA (Phase 3); the ledger contract is the same. */

import { Avatar, Button, Card, Field, Input, MqCheckCircle, MqScan, MqSearch, Select } from '@mirqam/ui'
import { computeEarn, normalizePhone, parseMoneyToMinor } from '@mirqam-points/shared'
import { useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi, useIdempotencyKey } from '../../lib/api.js'
import { money, num } from '../../lib/format.js'
import { unitLabel } from '../../lib/programs.js'
import { MemberForm } from './Members.jsx'

function Lookup({ onFound, onMissing }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const normalized = normalizePhone(phone)

  async function submit(e) {
    e.preventDefault()
    if (!normalized) return
    setBusy(true)
    setError(null)
    try {
      const found = await api(`/members/lookup?phone=${encodeURIComponent(normalized)}`)
      onFound(found.id)
    } catch (err) {
      if (err.code === 'member_not_found') onMissing(normalized)
      else setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t('cashier.phoneLabel')} hint={t('cashier.phoneHint')} error={error && errorText(error)}>
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="05XXXXXXXX"
            className="!min-h-14 text-center text-2xl font-bold tracking-wider"
            autoComplete="off"
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={busy} disabled={!normalized}>
        <MqSearch className="h-5 w-5" />
        {t('cashier.find')}
      </Button>
    </form>
  )
}

function Transact({ member, programs, onDone, onCancel }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const active = programs.filter((p) => p.status === 'active')
  const [mode, setMode] = useState('earn')
  const [programId, setProgramId] = useState(active[0]?.id)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Transact unmounts after success, so the next transaction always starts with a fresh key.
  const idem = useIdempotencyKey(`${mode}|${programId}|${amount}`)

  const program = active.find((p) => p.id === programId)
  const account = member.accounts.find((a) => a.program.id === programId)
  const balance = account?.balance ?? 0
  const purchaseMinor = mode === 'earn' ? parseMoneyToMinor(amount) : null
  const points =
    mode === 'earn' ? (program && purchaseMinor != null ? computeEarn(program.type, program.config, purchaseMinor) : 0) : Number.parseInt(amount, 10) || 0
  const valid = Boolean(program) && points > 0 && (mode === 'earn' || points <= balance)

  async function submit(e) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const body =
        mode === 'earn' ? { programId, memberId: member.id, purchaseMinor, source: 'pos' } : { programId, memberId: member.id, points, source: 'pos' }
      const result = await api(`/ledger/${mode}`, { method: 'POST', body, idempotencyKey: idem.key })
      onDone({ ...result, program, mode })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!active.length) return <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn">{t('transactions.noActivePrograms')}</p>

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div role="tablist" aria-label={t('cashier.mode')} className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-soft p-1">
        {['earn', 'redeem'].map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setAmount('')
            }}
            className={`min-h-11 rounded-xl text-sm font-bold transition ${mode === m ? 'bg-surface text-accent shadow-card' : 'text-muted'}`}
          >
            {t(`transactions.${m}`)}
          </button>
        ))}
      </div>
      {active.length > 1 && (
        <Field label={t('transactions.program')}>
          {(p) => (
            <Select {...p} value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {active.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <p className="text-sm text-muted">
        {t('cashier.currentBalance')}{' '}
        <strong className="tnum text-ink">
          {num(balance)} {unitLabel(program.type, t)}
        </strong>
      </p>
      <Field
        label={t(mode === 'earn' ? 'transactions.purchaseAmount' : 'transactions.redeemAmount')}
        hint={mode === 'earn' ? t('transactions.willEarn', { n: num(points), unit: unitLabel(program.type, t) }) : t('cashier.maxRedeem', { n: num(balance) })}
      >
        {(p) => (
          <Input
            {...p}
            inputMode={mode === 'earn' ? 'decimal' : 'numeric'}
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === 'earn' ? '0.00' : '0'}
            className="!min-h-14 text-center text-2xl font-bold"
            autoComplete="off"
            autoFocus
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Button type="submit" size="lg" loading={busy} disabled={!valid}>
          {mode === 'earn'
            ? t('cashier.confirmEarn', { n: num(points), unit: unitLabel(program.type, t), amount: purchaseMinor != null ? money(purchaseMinor, locale) : '—' })
            : t('cashier.confirmRedeem', { n: num(points), unit: unitLabel(program.type, t) })}
        </Button>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

export default function Cashier() {
  const { t } = useI18n()
  const programs = useApi('/programs')
  const [step, setStep] = useState({ name: 'lookup' })
  const member = useApi(step.memberId ? `/members/${step.memberId}?v=${step.v ?? 0}` : null)

  const reset = () => setStep({ name: 'lookup' })

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('nav.cashier')} subtitle={t('cashier.subtitle')} />
      <Card bodyClass="p-6 sm:p-8">
        {step.name === 'lookup' && (
          <Lookup onFound={(id) => setStep({ name: 'member', memberId: id })} onMissing={(phone) => setStep({ name: 'enroll', phone })} />
        )}

        {step.name === 'enroll' && (
          <>
            <h2 className="mb-1 text-lg font-bold">{t('cashier.newCustomer')}</h2>
            <p className="mb-5 text-sm text-muted">{t('cashier.newCustomerBody')}</p>
            <MemberForm
              initialPhone={step.phone}
              submitLabel={t('cashier.enrollAndContinue')}
              onCreated={(m) => setStep({ name: 'member', memberId: m.id })}
              onExisting={(id) => setStep({ name: 'member', memberId: id })}
            />
            <Button variant="ghost" className="mt-2 w-full" onClick={reset}>
              {t('common.back')}
            </Button>
          </>
        )}

        {step.name === 'member' &&
          /* Wait for the fresh fetch: a cashier must never act on a stale balance. */
          (member.data && !member.loading && programs.data ? (
            <>
              <div className="mb-6 flex items-center gap-4 border-b border-line pb-5">
                <Avatar name={member.data.name || member.data.phone.slice(-2)} size={52} />
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{member.data.name || t('members.unnamed')}</p>
                  <p className="tnum text-sm text-muted" dir="ltr">
                    {member.data.phone}
                  </p>
                </div>
              </div>
              <Transact
                member={member.data}
                programs={programs.data.items}
                onCancel={reset}
                onDone={(result) => setStep({ name: 'done', memberId: step.memberId, result })}
              />
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted">{t('common.loading')}</p>
          ))}

        {step.name === 'done' && (
          <div className="fade-in text-center">
            <MqCheckCircle className="mx-auto h-14 w-14 text-ok" />
            <h2 className="mt-4 text-xl font-bold">
              {t(step.result.mode === 'earn' ? 'cashier.earned' : 'cashier.redeemed', {
                n: num(Math.abs(step.result.entry.amount)),
                unit: unitLabel(step.result.program.type, t),
              })}
            </h2>
            <p className="mt-2 text-sm text-muted">{t('cashier.newBalance')}</p>
            <p className="tnum mt-1 text-[44px] font-bold leading-none">{num(step.result.balance)}</p>
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              <Button size="lg" onClick={() => setStep({ name: 'member', memberId: step.memberId, v: Date.now() })}>
                {t('cashier.sameCustomer')}
              </Button>
              <Button size="lg" variant="outline" onClick={reset}>
                <MqScan className="h-5 w-5" />
                {t('cashier.nextCustomer')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
