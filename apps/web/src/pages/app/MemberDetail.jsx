import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, MqArrowRight, MqLedger, MqPass, MqStamp, Skeleton, useToast } from '@mirqam/ui'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import EntriesTable from '../../components/EntriesTable.jsx'
import Qr from '../../components/Qr.jsx'
import TransactionModal from '../../components/TransactionModal.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, publicOrigin, useApi, useIdempotencyKey } from '../../lib/api.js'
import { day, num, signed } from '../../lib/format.js'
import { ruleSummary, unitLabel } from '../../lib/programs.js'
import { useSession } from '../../lib/session.jsx'
import { CopyButton } from './GiftCards.jsx'

function VoidModal({ entry, onClose, onDone }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The server keys a void by entry id alone, so one key per entry is exact.
  const idem = useIdempotencyKey(entry.id)
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api('/ledger/void', { method: 'POST', body: { entryId: entry.id, note: note.trim() || undefined }, idempotencyKey: idem.key })
      toast(t('transactions.voidDone'))
      onDone()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('transactions.voidTitle')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            {t('transactions.voidSubmit')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t('transactions.voidBody', { amount: signed(entry.amount) })}</p>
      <Field label={t('transactions.reason')} className="mt-4">
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
      </Field>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
    </Modal>
  )
}

/* The member's wallet card: they scan the QR with their own phone at the
   counter, open the card page and add it to Apple/Google Wallet. */
function CardModal({ account, memberId, onClose, onReissued }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { can } = useSession()
  const [busy, setBusy] = useState(false)
  const url = `${publicOrigin()}${account.passPath}`
  async function reissue() {
    if (!window.confirm(t('card.reissueConfirm'))) return
    setBusy(true)
    try {
      await api(`/members/${memberId}/accounts/${account.id}/reissue`, { method: 'POST' })
      toast(t('card.reissued'))
      onReissued()
      onClose()
    } catch (err) {
      toast(errorText(err), 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={t('card.title', { program: account.program.name })} closeLabel={t('common.close')}>
      <div className="grid justify-items-center gap-4 text-center">
        <p className="text-sm text-muted">{t('card.scanToAdd')}</p>
        <Qr value={url} size={200} label={t('card.title', { program: account.program.name })} />
        <p className="tnum text-xs text-muted" dir="ltr">
          {t('card.code')}: {account.code}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <CopyButton value={url} />
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center px-3 text-xs font-semibold text-accent hover:underline">
            {t('card.open')}
          </a>
        </div>
        {can('manage') && (
          <div className="mt-2 w-full border-t border-line pt-4 text-start">
            <p className="text-xs leading-relaxed text-muted">{t('card.reissueHint')}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reissue} loading={busy}>
              {t('card.reissue')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* Erasure at the member's own request (PDPL), made through the store. */
function EraseModal({ member, onClose }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api(`/members/${member.id}`, { method: 'DELETE' })
      toast(t('members.erasedDone'))
      navigate('/app/members', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('members.eraseTitle')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            {t('members.eraseConfirm')}
          </Button>
        </>
      }
    >
      <p className="font-semibold">
        {member.name || t('members.unnamed')} · <span dir="ltr">{member.phone}</span>
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">{t('members.eraseBody')}</p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
          {errorText(error)}
        </p>
      )}
    </Modal>
  )
}

function AccountCard({ account, onAction, onCard, canTransact }) {
  const { t, locale } = useI18n()
  const { program } = account
  const required = program.config.stampsRequired
  return (
    <article className="mq-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">{program.name}</h3>
          <p className="mt-0.5 text-xs text-muted">{ruleSummary(program, t, locale)}</p>
        </div>
        {program.status !== 'active' && <Badge tone="amber">{t(`programs.status.${program.status}`)}</Badge>}
      </div>
      <p className="mt-4 flex items-baseline gap-2">
        <span className="tnum text-[34px] font-bold leading-none">{num(account.balance)}</span>
        <span className="text-sm text-muted">{unitLabel(program.type, t)}</span>
      </p>
      {program.type === 'stamps' && required > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {Array.from({ length: Math.min(required, 20) }, (_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rotate-45 rounded-[3px] border ${i < account.balance ? 'border-brand-500 bg-brand-500' : 'border-line'}`} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {account.balance >= required ? t('members.rewardReady') : t('members.stampsToGo', { n: num(required - account.balance) })}
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t('members.lifetime', { n: num(account.lifetimeEarned) })}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => onCard(account)}>
          <MqPass className="h-4 w-4" />
          {t('card.button')}
        </Button>
        {canTransact && program.status === 'active' && (
          <>
            <Button size="sm" onClick={() => onAction('earn', program.id)}>
              {t('transactions.earn')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction('redeem', program.id)} disabled={account.balance === 0}>
              {t('transactions.redeem')}
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

export default function MemberDetail() {
  const { id } = useParams()
  const { t, locale } = useI18n()
  const { can } = useSession()
  const member = useApi(`/members/${id}`)
  const programs = useApi('/programs')
  const [tx, setTx] = useState(null) // { mode, programId }
  const [voiding, setVoiding] = useState(null)
  const [card, setCard] = useState(null)
  const [erasing, setErasing] = useState(false)
  const errorText = useErrorText()
  const toast = useToast()

  if (member.error) {
    return (
      <Card>
        <EmptyState
          icon={MqStamp}
          title={t('members.notFound')}
          action={
            <Link to="/app/members" className="font-semibold text-accent">
              {t('members.back')}
            </Link>
          }
        />
      </Card>
    )
  }
  if (!member.data || !programs.data) return <Skeleton rows={3} />

  const m = member.data
  const programById = Object.fromEntries(programs.data.items.map((p) => [p.id, p]))
  const entries = m.entries.map((e) => ({ ...e, program: programById[e.programId] }))
  const reload = () => member.reload()
  const withoutCard = programs.data.items.filter((p) => p.status === 'active' && !m.accounts.some((a) => a.program.id === p.id))
  async function openCard(programId) {
    try {
      await api(`/members/${m.id}/accounts`, { method: 'POST', body: { programId } })
      reload()
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  return (
    <>
      <Link to="/app/members" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <MqArrowRight className="h-4 w-4 ltr:rotate-180" />
        {t('members.back')}
      </Link>

      <section className="mq-card mb-6 flex flex-wrap items-center gap-5 p-6">
        <Avatar name={m.name || m.phone.slice(-2)} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{m.name || t('members.unnamed')}</h1>
          <p className="tnum mt-1 text-sm text-muted">
            <span dir="ltr">{m.phone}</span>
            {m.email && (
              <span className="ms-3" dir="ltr">
                {m.email}
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {m.marketingConsent ? <Badge tone="green">{t('members.consented')}</Badge> : <Badge>{t('members.notConsented')}</Badge>}
            <Badge tone="teal">{t('members.since', { date: day(m.createdAt, locale) })}</Badge>
            {!m.verified && <Badge tone="amber">{t('members.unverified')}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('transact') && <Button onClick={() => setTx({ mode: 'earn' })}>{t('transactions.earn')}</Button>}
          {can('transact') && (
            <Button variant="outline" onClick={() => setTx({ mode: 'redeem' })}>
              {t('transactions.redeem')}
            </Button>
          )}
          {can('manage') && (
            <Button variant="ghost" onClick={() => setTx({ mode: 'adjust' })}>
              {t('transactions.adjust')}
            </Button>
          )}
          {can('manage') && (
            <button
              type="button"
              onClick={() => setErasing(true)}
              className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-err hover:underline"
            >
              {t('members.erase')}
            </button>
          )}
        </div>
      </section>

      <h2 className="mb-3 text-lg font-bold">{t('members.balances')}</h2>
      {m.accounts.length ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {m.accounts.map((a) => (
            <AccountCard key={a.id} account={a} canTransact={can('transact')} onCard={setCard} onAction={(mode, programId) => setTx({ mode, programId })} />
          ))}
        </div>
      ) : (
        <p className="mq-card mb-4 p-5 text-sm text-muted">{t('members.noBalances')}</p>
      )}
      {!m.verified && <p className="mb-6 rounded-2xl border border-warn/20 bg-warn-bg px-4 py-3 text-sm text-warn">{t('members.unverifiedHint')}</p>}
      {can('transact') && withoutCard.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">{t('card.issueIn')}</span>
          {withoutCard.map((p) => (
            <Button key={p.id} size="sm" variant="outline" onClick={() => openCard(p.id)}>
              {p.name}
            </Button>
          ))}
        </div>
      )}

      <Card title={t('members.history')} bodyClass="">
        {entries.length ? (
          <EntriesTable items={entries} showMember={false} onVoid={can('manage') ? setVoiding : undefined} />
        ) : (
          <EmptyState icon={MqLedger} title={t('activity.emptyTitle')} />
        )}
      </Card>

      {tx && (
        <TransactionModal
          open
          mode={tx.mode}
          member={m}
          programs={programs.data.items}
          defaultProgramId={tx.programId}
          onClose={() => setTx(null)}
          onDone={reload}
        />
      )}
      {voiding && <VoidModal entry={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
      {card && <CardModal account={card} memberId={m.id} onClose={() => setCard(null)} onReissued={reload} />}
      {erasing && <EraseModal member={m} onClose={() => setErasing(false)} />}
    </>
  )
}
