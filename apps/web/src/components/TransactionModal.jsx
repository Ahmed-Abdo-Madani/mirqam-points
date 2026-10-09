/* Earn / redeem / adjust for one member. Retries of the same submission reuse
   one idempotency key, so a flaky connection can never double-post. */

import { Button, Field, Input, Modal, Select, useToast } from '@mirqam/ui'
import { computeEarn, parseMoneyToMinor } from '@mirqam-points/shared'
import { useState } from 'react'
import { useErrorText, useI18n } from '../i18n/index.jsx'
import { api, useIdempotencyKey } from '../lib/api.js'
import { num } from '../lib/format.js'
import { unitLabel } from '../lib/programs.js'

export default function TransactionModal({ open, onClose, mode, member, programs, defaultProgramId, onDone }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const eligible = mode === 'adjust' ? programs.filter((p) => p.status !== 'draft') : programs.filter((p) => p.status === 'active')
  const [programId, setProgramId] = useState(defaultProgramId && eligible.some((p) => p.id === defaultProgramId) ? defaultProgramId : eligible[0]?.id)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const idem = useIdempotencyKey(`${mode}|${programId}|${amount}|${note}`)

  const program = eligible.find((p) => p.id === programId)
  const purchaseMinor = mode === 'earn' ? parseMoneyToMinor(amount) : null
  const points =
    mode === 'earn' ? (program && purchaseMinor != null ? computeEarn(program.type, program.config, purchaseMinor) : 0) : Number.parseInt(amount, 10)
  const valid =
    Boolean(program) &&
    (mode === 'earn' ? points > 0 : Number.isInteger(points) && points !== 0 && (mode === 'adjust' || points > 0)) &&
    (mode !== 'adjust' || note.trim().length >= 3)

  async function submit(e) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    const body =
      mode === 'earn'
        ? { programId, memberId: member.id, purchaseMinor, ref: note.trim() || undefined }
        : mode === 'redeem'
          ? { programId, memberId: member.id, points, note: note.trim() || undefined }
          : { programId, memberId: member.id, points, note: note.trim() }
    try {
      const result = await api(`/ledger/${mode}`, { method: 'POST', body, idempotencyKey: idem.key })
      idem.rotate()
      toast(t(`transactions.${mode}Done`, { balance: num(result.balance), unit: unitLabel(program.type, t) }))
      onDone(result)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`transactions.${mode}Title`)}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="tx-form" loading={busy} disabled={!valid}>
            {t(`transactions.${mode}Submit`)}
          </Button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">{t('transactions.for', { name: member.name || member.phone })}</p>
        {eligible.length === 0 ? (
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">{t('transactions.noActivePrograms')}</p>
        ) : (
          <Field label={t('transactions.program')}>
            {(p) => (
              <Select {...p} value={programId} onChange={(e) => setProgramId(e.target.value)}>
                {eligible.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {mode === 'earn' ? (
          <Field label={t('transactions.purchaseAmount')} hint={program && t('transactions.willEarn', { n: num(points), unit: unitLabel(program.type, t) })}>
            {(p) => (
              <Input {...p} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" />
            )}
          </Field>
        ) : (
          <Field
            label={t(mode === 'adjust' ? 'transactions.adjustAmount' : 'transactions.redeemAmount')}
            hint={mode === 'adjust' ? t('transactions.adjustHint') : undefined}
          >
            {(p) => (
              <Input {...p} inputMode="numeric" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoComplete="off" />
            )}
          </Field>
        )}
        <Field label={t(mode === 'earn' ? 'transactions.invoiceRef' : mode === 'adjust' ? 'transactions.reason' : 'transactions.note')}>
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={mode === 'earn' ? 120 : 500} required={mode === 'adjust'} />}
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
