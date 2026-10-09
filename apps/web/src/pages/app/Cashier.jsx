/* Counter flow: phone / scanned card → (enroll if new) → earn or redeem → confirmation.
   Gift cards: scanned or typed code → balance → partial or full spend.
   Large targets, one decision per screen; the native app adds the camera scanner. */

import { Avatar, Button, Card, Field, Input, MqCheckCircle, MqGift, MqScan, MqSearch, Select } from '@mirqam/ui'
import { computeEarn, normalizePhone, parseMoneyToMinor } from '@mirqam-points/shared'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi, useIdempotencyKey } from '../../lib/api.js'
import { money, num } from '../../lib/format.js'
import { unitLabel } from '../../lib/programs.js'
import { canScan, ScanError, scanCode } from '../../lib/scanner.js'
import { MemberForm } from './Members.jsx'

const LOYALTY_CODE = /^(MP:)?[0-9A-F]{10}$/i
const GIFT_CODE = /^[0-9A-Z]{16}$/
const compactCode = (v) => v.trim().toUpperCase().replace(/[\s-]/g, '')

/* One field for everything the customer can present: a mobile number, a
   wallet-pass code (MP:XXXXXXXXXX) or a gift-card code. In the native app the
   camera fills it in. */
function Lookup({ onFound, onMissing, onGift }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const compact = compactCode(value)
  const usable = Boolean(normalizePhone(value)) || LOYALTY_CODE.test(compact) || GIFT_CODE.test(compact)

  async function find(raw) {
    const v = compactCode(raw)
    setBusy(true)
    setError(null)
    try {
      if (GIFT_CODE.test(v)) return onGift(v)
      if (LOYALTY_CODE.test(v)) {
        const found = await api(`/members/lookup?code=${encodeURIComponent(v)}`)
        return onFound(found.id, found.matchedProgramId)
      }
      const normalized = normalizePhone(raw)
      if (!normalized) return
      try {
        const found = await api(`/members/lookup?phone=${encodeURIComponent(normalized)}`)
        onFound(found.id)
      } catch (err) {
        if (err.code === 'member_not_found') onMissing(normalized)
        else throw err
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function scan() {
    try {
      const code = await scanCode()
      if (code) {
        setValue(code)
        await find(code)
      }
    } catch (err) {
      setError(err instanceof ScanError ? { code: err.code } : err)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (usable) find(value)
      }}
      className="grid gap-4"
    >
      {canScan() && (
        <Button size="lg" onClick={scan} className="!min-h-16 text-base">
          <MqScan className="h-6 w-6" />
          {t('cashier.scan')}
        </Button>
      )}
      <Field label={t('cashier.phoneLabel')} hint={t('cashier.phoneHint')} error={error && errorText(error)}>
        {(p) => (
          <Input
            {...p}
            dir="ltr"
            autoFocus={!canScan()}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="05XXXXXXXX"
            className="!min-h-14 text-center text-2xl font-bold tracking-wider"
            autoComplete="off"
            autoCapitalize="characters"
          />
        )}
      </Field>
      <Button type="submit" size="lg" variant={canScan() ? 'outline' : 'primary'} loading={busy} disabled={!usable}>
        <MqSearch className="h-5 w-5" />
        {t('cashier.find')}
      </Button>
    </form>
  )
}

/* Gift card at the counter: balance check, then spend part or all of it. */
function GiftRedeem({ code, onDone, onCancel }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const [card, setCard] = useState(null)
  const [error, setError] = useState(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const amountMinor = parseMoneyToMinor(amount)
  const idem = useIdempotencyKey(`${code}|${amount}`)

  useEffect(() => {
    api('/gift-cards/lookup', { method: 'POST', body: { code } }).then(setCard, setError)
  }, [code])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone(await api('/gift-cards/redeem', { method: 'POST', body: { code, amountMinor }, idempotencyKey: idem.key }))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (error && !card)
    return (
      <div className="grid gap-4 text-center">
        <p className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">{errorText(error)}</p>
        <Button variant="outline" onClick={onCancel}>
          {t('common.back')}
        </Button>
      </div>
    )
  if (!card) return <p className="py-10 text-center text-sm text-muted">{t('common.loading')}</p>
  const spendable = card.status === 'active' && !card.expired
  const valid = spendable && amountMinor != null && amountMinor > 0 && amountMinor <= card.balanceMinor
  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="mp-pass flex items-center gap-3 p-5 text-white">
        <MqGift className="h-7 w-7 text-brand-300" />
        <span>
          <small className="block text-xs">
            {t('gift.title')} · •••• {card.last4}
          </small>
          <span className="tnum text-2xl font-bold">{money(card.balanceMinor, locale)}</span>
        </span>
      </div>
      {!spendable && <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">{card.expired ? t('gift.expired') : t(`gift.status.${card.status}`)}</p>}
      {spendable && (
        <>
          <Field label={t('gift.redeemAmount')} hint={t('gift.redeemHint', { amount: money(card.balanceMinor, locale) })}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                dir="ltr"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="!min-h-14 text-center text-2xl font-bold"
                autoFocus
              />
            )}
          </Field>
          <button
            type="button"
            className="justify-self-start text-sm font-semibold text-accent"
            onClick={() => setAmount((card.balanceMinor / 100).toFixed(2))}
          >
            {t('gift.useFull')}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        {spendable && (
          <Button type="submit" size="lg" loading={busy} disabled={!valid}>
            {t('gift.redeemSubmit', { amount: amountMinor ? money(amountMinor, locale) : '—' })}
          </Button>
        )}
        <Button variant="ghost" size="lg" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

function Transact({ member, programs, preferredProgramId, onDone, onCancel }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const active = programs.filter((p) => p.status === 'active')
  const [mode, setMode] = useState('earn')
  const [programId, setProgramId] = useState(active.some((p) => p.id === preferredProgramId) ? preferredProgramId : active[0]?.id)
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
  const { t, locale } = useI18n()
  const programs = useApi('/programs')
  const [step, setStep] = useState({ name: 'lookup' })
  const member = useApi(step.memberId ? `/members/${step.memberId}?v=${step.v ?? 0}` : null)

  const reset = () => setStep({ name: 'lookup' })

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('nav.cashier')} subtitle={t('cashier.subtitle')} />
      <Card bodyClass="p-6 sm:p-8">
        {step.name === 'lookup' && (
          <Lookup
            onFound={(id, programId) => setStep({ name: 'member', memberId: id, programId })}
            onMissing={(phone) => setStep({ name: 'enroll', phone })}
            onGift={(code) => setStep({ name: 'gift', code })}
          />
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
                preferredProgramId={step.programId}
                onCancel={reset}
                onDone={(result) => setStep({ name: 'done', memberId: step.memberId, result })}
              />
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted">{t('common.loading')}</p>
          ))}

        {step.name === 'gift' && <GiftRedeem code={step.code} onCancel={reset} onDone={(result) => setStep({ name: 'giftDone', result })} />}

        {step.name === 'giftDone' && (
          <div className="fade-in text-center">
            <MqCheckCircle className="mx-auto h-14 w-14 text-ok" />
            <h2 className="mt-4 text-xl font-bold">{t('gift.redeemed', { amount: money(Math.abs(step.result.entry.amountMinor), locale) })}</h2>
            <p className="mt-2 text-sm text-muted">{t('gift.remaining')}</p>
            <p className="tnum mt-1 text-[40px] font-bold leading-none">{money(step.result.card.balanceMinor, locale)}</p>
            <Button size="lg" className="mt-8 w-full" onClick={reset}>
              <MqScan className="h-5 w-5" />
              {t('cashier.nextCustomer')}
            </Button>
          </div>
        )}

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
