import { Badge, Button, Card, EmptyState, Field, Input, Modal, MqCopy, MqGift, MqPlus, Select, Skeleton, Stat, Textarea, useToast } from '@mirqam/ui'
import { normalizePhone, parseMoneyToMinor } from '@mirqam-points/shared'
import { useState } from 'react'
import { PageHeader } from '../../components/AppShell.jsx'
import Pagination from '../../components/Pagination.jsx'
import Qr from '../../components/Qr.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi, useIdempotencyKey } from '../../lib/api.js'
import { dateTime, day, money } from '../../lib/format.js'
import { useSession } from '../../lib/session.jsx'

const PAGE = 25
const STATUS_TONE = { active: 'green', frozen: 'amber', voided: 'red' }

export function CopyButton({ value }) {
  const { t } = useI18n()
  const toast = useToast()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          toast(t('common.copied'))
        } catch {
          toast(t('common.copyFailed'), 'err')
        }
      }}
    >
      <MqCopy className="h-4 w-4" />
      {t('common.copy')}
    </Button>
  )
}

/** Shown once after selling: code + link + QR for the recipient. */
function IssuedCard({ result, onClose }) {
  const { t, locale } = useI18n()
  return (
    <Modal open onClose={onClose} title={t('gift.issuedTitle')} closeLabel={t('common.close')} footer={<Button onClick={onClose}>{t('common.done')}</Button>}>
      <div className="grid justify-items-center gap-4 text-center">
        <p className="tnum text-3xl font-bold">{money(result.card.initialMinor, locale)}</p>
        <Qr value={result.url} size={170} label={t('gift.qrLabel')} />
        <p className="text-sm text-muted">{t('gift.issuedBody')}</p>
        <div className="w-full rounded-2xl bg-soft p-4">
          <p className="text-xs text-muted">{t('gift.code')}</p>
          <p className="tnum mt-1 font-mono text-lg font-bold tracking-wider" dir="ltr">
            {result.code}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <CopyButton value={result.url} />
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-3 text-xs font-semibold text-accent hover:underline"
          >
            {t('gift.openCard')}
          </a>
        </div>
      </div>
    </Modal>
  )
}

function SellModal({ onClose, onSold }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [form, setForm] = useState({ amount: '', recipientName: '', recipientPhone: '', senderName: '', message: '', expires: '12' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const amountMinor = parseMoneyToMinor(form.amount)
  const phoneOk = !form.recipientPhone.trim() || Boolean(normalizePhone(form.recipientPhone))
  const valid = amountMinor != null && amountMinor >= 100 && phoneOk
  const idem = useIdempotencyKey(JSON.stringify(form))

  async function submit(e) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    const body = { amountMinor, expiresInMonths: form.expires === 'none' ? null : Number(form.expires) }
    for (const k of ['recipientName', 'recipientPhone', 'senderName', 'message']) if (form[k].trim()) body[k] = form[k].trim()
    try {
      onSold(await api('/gift-cards', { method: 'POST', body, idempotencyKey: idem.key }))
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
      title={t('gift.sell')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="sell-form" loading={busy} disabled={!valid}>
            {t('gift.sellSubmit')}
          </Button>
        </>
      }
    >
      <form id="sell-form" onSubmit={submit} className="grid gap-4" noValidate>
        <p className="rounded-xl bg-tint px-4 py-3 text-xs leading-relaxed">{t('gift.paymentNote')}</p>
        <Field label={t('gift.amount')}>
          {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={form.amount} onChange={set('amount')} placeholder="0.00" autoFocus />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('gift.recipientName')}>{(p) => <Input {...p} value={form.recipientName} onChange={set('recipientName')} maxLength={120} />}</Field>
          <Field label={t('gift.recipientPhone')} error={phoneOk ? undefined : t('validation.phone')}>
            {(p) => <Input {...p} type="tel" dir="ltr" value={form.recipientPhone} onChange={set('recipientPhone')} placeholder="05XXXXXXXX" />}
          </Field>
        </div>
        <Field label={t('gift.senderName')}>{(p) => <Input {...p} value={form.senderName} onChange={set('senderName')} maxLength={120} />}</Field>
        <Field label={t('gift.message')}>{(p) => <Textarea {...p} rows={2} value={form.message} onChange={set('message')} maxLength={300} />}</Field>
        <Field label={t('gift.validity')}>
          {(p) => (
            <Select {...p} value={form.expires} onChange={set('expires')}>
              {['6', '12', '24'].map((m) => (
                <option key={m} value={m}>
                  {t('gift.months', { n: m })}
                </option>
              ))}
              <option value="none">{t('gift.noExpiry')}</option>
            </Select>
          )}
        </Field>
        {error && (
          <p role="alert" className="rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
            {errorText(error)}
          </p>
        )}
      </form>
    </Modal>
  )
}

function CardDetail({ id, onClose, onChanged }) {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { can } = useSession()
  const { data, reload } = useApi(`/gift-cards/${id}`)
  const idem = useIdempotencyKey(`void|${id}`)

  async function act(path, body, opts = {}) {
    try {
      await api(`/gift-cards/${id}/${path}`, { method: 'POST', body, ...opts })
      toast(t('common.saved'))
      reload()
      onChanged()
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t('gift.detail')} closeLabel={t('common.close')}>
      {!data ? (
        <Skeleton />
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="tnum text-3xl font-bold">{money(data.balanceMinor, locale)}</p>
              <p className="text-xs text-muted">
                {t('gift.ofInitial', { amount: money(data.initialMinor, locale) })} · •••• {data.last4}
              </p>
            </div>
            <Badge tone={STATUS_TONE[data.status]}>{t(`gift.status.${data.status}`)}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={data.url} />
            {can('manage') && data.status === 'active' && (
              <Button variant="outline" size="sm" onClick={() => act('status', { status: 'frozen' })}>
                {t('gift.freeze')}
              </Button>
            )}
            {can('manage') && data.status === 'frozen' && (
              <Button variant="outline" size="sm" onClick={() => act('status', { status: 'active' })}>
                {t('gift.unfreeze')}
              </Button>
            )}
            {can('manage') && data.status !== 'voided' && (
              <Button variant="danger" size="sm" onClick={() => window.confirm(t('gift.voidConfirm')) && act('void', {}, { idempotencyKey: idem.key })}>
                {t('gift.void')}
              </Button>
            )}
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{t(`gift.kinds.${e.kind}`)}</span>
                  <span className="ms-2 text-xs text-muted">{[dateTime(e.createdAt, locale), e.ref, e.actorName].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`tnum font-bold ${e.amountMinor > 0 ? 'text-ok' : ''}`} dir="ltr">
                  {e.amountMinor > 0 ? '+' : '−'}
                  {money(Math.abs(e.amountMinor), locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

export default function GiftCards() {
  const { t, locale } = useI18n()
  const { can } = useSession()
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [selling, setSelling] = useState(false)
  const [issued, setIssued] = useState(null)
  const [open, setOpen] = useState(null)
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
  if (status) params.set('status', status)
  const { data, loading, reload } = useApi(`/gift-cards?${params}`)

  return (
    <>
      <PageHeader
        title={t('nav.giftCards')}
        subtitle={t('gift.subtitle')}
        actions={
          can('transact') && (
            <Button onClick={() => setSelling(true)}>
              <MqPlus className="h-4 w-4" />
              {t('gift.sell')}
            </Button>
          )
        }
      />
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Stat label={t('gift.outstanding')} value={money(data.outstandingMinor, locale)} hint={t('gift.outstandingHint')} icon={MqGift} tone="amber" />
          <Stat label={t('gift.issued')} value={money(data.issuedMinor, locale)} hint={t('gift.cardsCount', { n: data.total })} icon={MqGift} />
        </div>
      )}
      <Card bodyClass="">
        <div className="border-b border-line p-4">
          <label className="block w-full sm:w-52">
            <span className="sr-only">{t('activity.type')}</span>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setOffset(0)
              }}
            >
              <option value="">{t('gift.allStatuses')}</option>
              {['active', 'frozen', 'voided'].map((s) => (
                <option key={s} value={s}>
                  {t(`gift.status.${s}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {loading && !data ? (
          <Skeleton className="px-6" />
        ) : !data?.items.length ? (
          <EmptyState icon={MqGift} title={t('gift.emptyTitle')} desc={t('gift.emptyBody')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead className="border-b border-line">
                  <tr>
                    <th className="th-base">{t('gift.card')}</th>
                    <th className="th-base">{t('gift.recipient')}</th>
                    <th className="th-base text-end">{t('gift.balance')}</th>
                    <th className="th-base">{t('gift.statusLabel')}</th>
                    <th className="th-base">{t('gift.expiresAt')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((c) => (
                    <tr key={c.id} className="cursor-pointer transition hover:bg-brand-500/[0.03]" onClick={() => setOpen(c.id)}>
                      <td className="td-base">
                        <button
                          type="button"
                          className="tnum font-semibold hover:text-accent"
                          dir="ltr"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen(c.id)
                          }}
                        >
                          •••• {c.last4}
                        </button>
                      </td>
                      <td className="td-base text-muted">{c.recipientName || '—'}</td>
                      <td className="td-base tnum text-end font-bold">
                        {money(c.balanceMinor, locale)}
                        <span className="block text-xs font-normal text-muted">{t('gift.ofInitial', { amount: money(c.initialMinor, locale) })}</span>
                      </td>
                      <td className="td-base">
                        <Badge tone={c.expired ? 'gray' : STATUS_TONE[c.status]}>{c.expired ? t('gift.expired') : t(`gift.status.${c.status}`)}</Badge>
                      </td>
                      <td className="td-base text-muted">{c.expiresAt ? day(c.expiresAt, locale) : t('gift.noExpiry')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} limit={PAGE} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
      {selling && (
        <SellModal
          onClose={() => setSelling(false)}
          onSold={(result) => {
            setSelling(false)
            setIssued(result)
            reload()
          }}
        />
      )}
      {issued && <IssuedCard result={issued} onClose={() => setIssued(null)} />}
      {open && <CardDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}
