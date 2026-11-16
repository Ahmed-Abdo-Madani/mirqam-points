/* Counter flow: phone / scanned card → (enroll if new) → earn or redeem → confirmation.
   Gift cards: scanned or typed code → balance → partial or full spend.
   Large targets, one decision per screen; the native app adds the camera scanner. */

import { Avatar, Button, Card, Field, Input, MqArrowLeft, MqArrowRight, MqCheckCircle, MqGift, MqScan, MqSearch, MqStamp, Select } from '@mirqam/ui'
import { computeEarn, normalizePhone, parseMoneyToMinor } from '@mirqam-points/shared'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import { activeRewards, isolate, RewardPicker, rewardDetail, Stepper } from '../../components/Rewards.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi, useIdempotencyKey } from '../../lib/api.js'
import { dateTime, money, num, signed } from '../../lib/format.js'
import { unitLabel } from '../../lib/programs.js'
import { canScan, ScanError, scanCode } from '../../lib/scanner.js'
import { useSession } from '../../lib/session.jsx'
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
    const byCode = async () => {
      const found = await api(`/members/lookup?code=${encodeURIComponent(v)}`)
      onFound(found.id, found.matchedProgramId)
    }
    try {
      if (GIFT_CODE.test(v)) return onGift(v)
      // A scanned pass always carries the MP: prefix.
      if (v.startsWith('MP:')) return await byCode()
      // A typed 10-digit mobile (05…) is also valid hex, so phone wins; the
      // card code is the fallback when no member has that number.
      const normalized = normalizePhone(raw)
      if (normalized) {
        try {
          const found = await api(`/members/lookup?phone=${encodeURIComponent(normalized)}`)
          return onFound(found.id)
        } catch (err) {
          if (err.code !== 'member_not_found') throw err
        }
        if (LOYALTY_CODE.test(v)) {
          try {
            return await byCode()
          } catch (err) {
            if (err.code !== 'member_not_found') throw err
          }
        }
        return onMissing(normalized)
      }
      if (LOYALTY_CODE.test(v)) return await byCode()
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

  const scanning = canScan()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (usable) find(value)
      }}
      className="grid gap-4"
    >
      <StoreCard />
      <Field label={t('cashier.phoneLabel')} hint={t('cashier.phoneHint')} error={error && errorText(error)}>
        {(p) => (
          <div className="flex gap-2">
            <Input
              {...p}
              dir="ltr"
              autoFocus={!scanning}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="05XXXXXXXX"
              className="!min-h-14 min-w-0 flex-1 text-center text-xl font-bold tracking-wider"
              autoComplete="off"
              autoCapitalize="characters"
            />
            <Button type="submit" size="lg" variant={scanning ? 'outline' : 'primary'} loading={busy} disabled={!usable} className="!min-h-14 shrink-0">
              <MqSearch className="h-5 w-5" />
              {t('cashier.find')}
            </Button>
          </div>
        )}
      </Field>
      {scanning && (
        <>
          <div className="flex items-center gap-3 text-xs font-semibold text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            {t('cashier.or')}
          </div>
          <button
            type="button"
            onClick={scan}
            className="grid min-h-56 place-items-center content-center gap-3 rounded-[24px] bg-primary px-6 text-on-primary shadow-card transition hover:bg-primary-hover"
          >
            <MqScan className="h-16 w-16" />
            <span className="text-lg font-bold">{t('cashier.scan')}</span>
            <span className="text-xs opacity-80">{t('cashier.scanHint')}</span>
          </button>
        </>
      )}
    </form>
  )
}

/* Which store and who is at the counter, so a shared device never serves the wrong workspace. */
function StoreCard() {
  const { t } = useI18n()
  const { me } = useSession()
  return (
    <div className="mq-card flex items-center gap-3 !p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-primary text-lg font-bold text-on-primary">
        {me?.tenant.name?.[0]}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{me?.tenant.name}</span>
        <span className="block truncate text-xs text-muted">
          {me?.user.name} · {t(`roles.${me?.role}`)}
        </span>
      </span>
    </div>
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

/* The customer card, in the order counter staff know from other loyalty apps: overview tiles, an
   Add / Redeem switch, one stepper and one confirm button, then the latest transactions. */
function Overview({ program, account, balance }) {
  const { t } = useI18n()
  const rewards = activeRewards(program)
  const required = program.type === 'stamps' ? program.config.stampsRequired : null
  // Catalogue rewards the balance covers; a stamp card without a catalogue has one reward per full card.
  const available = rewards.length ? rewards.filter((r) => r.cost <= balance).length : required ? Math.floor(balance / required) : 0
  const filled = required ? (balance >= required ? required : balance) : 0
  const tiles = [
    [t(program.type === 'stamps' ? 'cashier.stampBalance' : 'cashier.pointBalance'), balance],
    [t('cashier.availableRewards'), available],
    [t('cashier.pastRedemptions'), account?.redemptions ?? 0],
  ]
  return (
    <section aria-label={t('cashier.overview')} className="grid gap-3">
      <h2 className="text-base font-bold">{t('cashier.overview')}</h2>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface p-3">
            <p className="min-h-8 text-[11.5px] leading-snug text-muted">{label}</p>
            <p className="tnum mt-1 text-2xl font-bold">{num(value)}</p>
          </div>
        ))}
      </div>
      {required && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <p className="mb-2 flex justify-between gap-2 text-xs">
            <span className="truncate font-semibold">{program.name}</span>
            <span className="tnum shrink-0 text-muted">{t('cashier.stampProgress', { n: num(filled), required: num(required) })}</span>
          </p>
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {Array.from({ length: required }, (_, i) => (
              <span key={i} className={`h-6 w-6 rounded-full border-2 ${i < filled ? 'border-accent bg-accent' : 'border-dashed border-line'}`} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function LatestTransactions({ entries }) {
  const { t, locale } = useI18n()
  return (
    <section aria-label={t('cashier.latest')} className="grid gap-2">
      <h2 className="flex items-baseline justify-between text-base font-bold">
        {t('cashier.latest')}
        <span className="text-xs font-normal text-muted">{t('cashier.latestHint')}</span>
      </h2>
      {entries.length ? (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
          {entries.map((e) => (
            <li key={e.id} className={`flex items-center gap-3 py-3 ${e.voided ? 'opacity-60' : ''}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-soft text-muted">
                {e.kind === 'redeem' ? <MqGift className="h-4 w-4" /> : <MqStamp className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold" dir="auto">
                  {e.kind === 'redeem' && e.rewardName ? e.rewardName : t(`kinds.${e.kind}`)}
                  {e.voided && <span className="ms-2 text-xs text-err">{t('activity.voided')}</span>}
                </span>
                <span className="block text-xs text-muted">{dateTime(e.createdAt, locale)}</span>
              </span>
              <span className={`tnum text-sm font-bold ${e.amount > 0 ? 'text-ok' : 'text-ink'}`} dir="ltr">
                {signed(e.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('cashier.noTransactions')}</p>
      )}
    </section>
  )
}

function Transact({ member, programs, preferredProgramId, onDone }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const active = programs.filter((p) => p.status === 'active')
  const [mode, setMode] = useState('earn')
  // Scanned cards open their own program; otherwise a stamp card that needs no bill amount is the quickest default.
  const fastStamp = active.find((p) => p.type === 'stamps' && !p.config.minPurchaseMinor)
  const [programId, setProgramId] = useState(active.some((p) => p.id === preferredProgramId) ? preferredProgramId : (fastStamp ?? active[0])?.id)
  const [amount, setAmount] = useState('')
  // Stamp cards default to a plain stamp with no bill amount; the cashier can opt into entering one.
  const [withBill, setWithBill] = useState(false)
  // Several items in one order: the server multiplies stampsPerVisit by this.
  const [visits, setVisits] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Redeeming from the catalogue: which reward and how many. A typed number stays as the fallback.
  const [rewardId, setRewardId] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [typeNumber, setTypeNumber] = useState(false)

  const program = active.find((p) => p.id === programId)
  const account = member.accounts.find((a) => a.program.id === programId)
  const balance = account?.balance ?? 0
  const rewards = activeRewards(program)
  const byReward = mode === 'redeem' && rewards.length > 0 && !typeNumber
  const reward = byReward ? rewards.find((r) => r.id === rewardId) : null
  // A flat stamp needs a stamp card without a minimum purchase; everything else is priced by the bill.
  const canSkipBill = program?.type === 'stamps' && !program.config.minPurchaseMinor
  const visitOnly = mode === 'earn' && canSkipBill && !withBill
  // Transact unmounts after success, so the next transaction always starts with a fresh key.
  const idem = useIdempotencyKey(`${mode}|${programId}|${visitOnly ? `visit${visits}` : byReward ? `${rewardId}x${quantity}` : amount}`)
  const purchaseMinor = mode === 'earn' && !visitOnly ? parseMoneyToMinor(amount) : null
  const points = visitOnly
    ? program.config.stampsPerVisit * visits
    : mode === 'earn'
      ? program && purchaseMinor != null
        ? computeEarn(program.type, program.config, purchaseMinor)
        : 0
      : byReward
        ? (reward?.cost ?? 0) * quantity
        : Number.parseInt(amount, 10) || 0
  const valid = Boolean(program) && points > 0 && (mode === 'earn' || points <= balance)
  const unit = program ? unitLabel(program.type, t) : ''
  const entries = (member.entries ?? []).filter((e) => e.programId === programId).slice(0, 6)

  function clear() {
    setAmount('')
    setRewardId(null)
    setQuantity(1)
    setVisits(1)
  }

  async function submit(e) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const earnBy = visitOnly ? (visits > 1 ? { visits } : {}) : { purchaseMinor }
      const body =
        mode === 'earn'
          ? { programId, memberId: member.id, ...earnBy, source: 'pos' }
          : byReward
            ? { programId, memberId: member.id, rewardId, quantity, source: 'pos' }
            : { programId, memberId: member.id, points, source: 'pos' }
      const result = await api(`/ledger/${mode}`, { method: 'POST', body, idempotencyKey: idem.key })
      onDone({ ...result, program, mode, rewardDetail: reward ? rewardDetail(reward, t, locale) : null })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!active.length) return <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn">{t('transactions.noActivePrograms')}</p>

  const confirmLabel = visitOnly
    ? t('cashier.confirmStamp', { n: num(points), unit })
    : mode === 'earn'
      ? t('cashier.confirmEarn', { n: num(points), unit, amount: purchaseMinor != null ? money(purchaseMinor, locale) : '—' })
      : reward
        ? t('rewards.confirm', { reward: isolate(reward.name), qty: num(quantity), n: num(points), unit })
        : byReward
          ? t('rewards.pick')
          : t('cashier.confirmRedeem', { n: num(points), unit })
  const confirm = (
    <Button type="submit" size="lg" loading={busy} disabled={!valid} className="!min-h-14 w-full">
      {confirmLabel}
    </Button>
  )

  return (
    <form onSubmit={submit} className="grid gap-5">
      {active.length > 1 && (
        <Field label={t('transactions.program')}>
          {(p) => (
            <Select
              {...p}
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value)
                clear()
              }}
            >
              {active.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Overview program={program} account={account} balance={balance} />

      <div role="tablist" aria-label={t('cashier.mode')} className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1">
        {['earn', 'redeem'].map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              clear()
            }}
            className={`min-h-12 rounded-xl text-sm font-bold transition ${mode === m ? 'bg-primary text-on-primary shadow-card' : 'text-muted hover:text-ink'}`}
          >
            {t(m === 'earn' ? (program.type === 'stamps' ? 'cashier.addStamps' : 'cashier.addPoints') : 'transactions.redeem')}
          </button>
        ))}
      </div>

      {visitOnly ? (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">{t('cashier.howManyStamps')}</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <Stepper value={visits} max={Math.max(1, Math.floor(20 / program.config.stampsPerVisit))} onChange={setVisits} label={t('cashier.howManyStamps')} />
            {confirm}
          </div>
        </div>
      ) : (
        <>
          {byReward ? (
            <RewardPicker program={program} balance={balance} selected={rewardId} quantity={quantity} onSelect={setRewardId} onQuantity={setQuantity} />
          ) : (
            <Field
              label={t(mode === 'earn' ? 'transactions.purchaseAmount' : 'transactions.redeemAmount')}
              hint={mode === 'earn' ? t('transactions.willEarn', { n: num(points), unit }) : t('cashier.maxRedeem', { n: num(balance) })}
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
                />
              )}
            </Field>
          )}
          {confirm}
        </>
      )}

      {mode === 'earn' && canSkipBill && (
        <button
          type="button"
          className="justify-self-start text-sm font-semibold text-accent"
          onClick={() => {
            setWithBill((v) => !v)
            clear()
          }}
        >
          {t(withBill ? 'cashier.skipBill' : 'cashier.addBill')}
        </button>
      )}
      {mode === 'redeem' && rewards.length > 0 && (
        <button
          type="button"
          className="justify-self-start text-sm font-semibold text-accent"
          onClick={() => {
            setTypeNumber((v) => !v)
            clear()
          }}
        >
          {t(typeNumber ? 'rewards.useCatalogue' : 'rewards.typeNumber')}
        </button>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}

      <LatestTransactions entries={entries} />
    </form>
  )
}

export default function Cashier() {
  const { t, locale, dir } = useI18n()
  const programs = useApi('/programs')
  const [step, setStep] = useState({ name: 'lookup' })
  const member = useApi(step.memberId ? `/members/${step.memberId}?v=${step.v ?? 0}` : null)

  const reset = () => setStep({ name: 'lookup' })

  const Back = dir === 'rtl' ? MqArrowRight : MqArrowLeft

  if (step.name === 'lookup')
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t('nav.cashier')} subtitle={t('cashier.subtitle')} />
        <Lookup
          onFound={(id, programId) => setStep({ name: 'member', memberId: id, programId })}
          onMissing={(phone) => setStep({ name: 'enroll', phone })}
          onGift={(code) => setStep({ name: 'gift', code })}
        />
      </div>
    )

  if (step.name === 'member')
    return (
      <div className="mx-auto grid max-w-xl gap-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            aria-label={t('common.back')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-soft"
          >
            <Back className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">{t('cashier.customerTitle')}</h1>
        </div>
        {/* Wait for the fresh fetch: a cashier must never act on a stale balance. */}
        {member.data && !member.loading && programs.data ? (
          <>
            <div className="mq-card flex items-center gap-4 !p-4">
              <Avatar name={member.data.name || member.data.phone.slice(-2)} size={56} />
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
              onDone={(result) => setStep({ name: 'done', memberId: step.memberId, result })}
            />
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted">{t('common.loading')}</p>
        )}
      </div>
    )

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t('nav.cashier')} subtitle={t('cashier.subtitle')} />
      <Card bodyClass="p-6 sm:p-8">
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
              {step.result.reward
                ? t('rewards.redeemed', { reward: isolate(step.result.reward.name), qty: num(step.result.reward.quantity) })
                : t(step.result.mode === 'earn' ? 'cashier.earned' : 'cashier.redeemed', {
                    n: num(Math.abs(step.result.entry.amount)),
                    unit: unitLabel(step.result.program.type, t),
                  })}
            </h2>
            {step.result.reward && (
              <p className="mt-2 rounded-2xl bg-tint px-4 py-2 text-sm font-semibold text-accent">
                {t('rewards.giveCustomer', { detail: step.result.rewardDetail })}
                {step.result.reward.quantity > 1 && ` × ${num(step.result.reward.quantity)}`}
              </p>
            )}
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
