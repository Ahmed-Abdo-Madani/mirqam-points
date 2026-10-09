import { Avatar, Button, Card, Field, Input, Modal, MqPlus, MqTrash, Select, Skeleton, useToast } from '@mirqam/ui'
import { useState } from 'react'
import { PageHeader, RoleBadge } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { day } from '../../lib/format.js'
import { useSession } from '../../lib/session.jsx'

const ASSIGNABLE = ['manager', 'cashier', 'analyst']

function AddStaff({ onClose, onAdded }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  const [form, setForm] = useState({ name: '', email: '', role: 'cashier', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/staff', { method: 'POST', body: form })
      onAdded()
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
      title={t('staff.add')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="staff-form" loading={busy}>
            {t('staff.add')}
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label={t('auth.name')}>{(p) => <Input {...p} value={form.name} onChange={set('name')} required />}</Field>
        <Field label={t('auth.email')}>{(p) => <Input {...p} type="email" dir="ltr" value={form.email} onChange={set('email')} required />}</Field>
        <Field label={t('staff.role')} hint={t(`staff.roleHint.${form.role}`)}>
          {(p) => (
            <Select {...p} value={form.role} onChange={set('role')}>
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('staff.initialPassword')} hint={t('staff.initialPasswordHint')}>
          {(p) => <Input {...p} type="text" dir="ltr" value={form.password} onChange={set('password')} autoComplete="new-password" required />}
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

export default function Staff() {
  const { t, locale } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { me, can } = useSession()
  const { data, loading, reload } = useApi('/staff')
  const [adding, setAdding] = useState(false)
  const isOwner = can('owner')

  async function changeRole(person, role) {
    try {
      await api(`/staff/${person.id}`, { method: 'PATCH', body: { role } })
      toast(t('staff.roleChanged'))
      reload()
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }
  async function remove(person) {
    if (!window.confirm(t('staff.removeConfirm', { name: person.name }))) return
    try {
      await api(`/staff/${person.id}`, { method: 'DELETE' })
      toast(t('staff.removed'))
      reload()
    } catch (err) {
      toast(errorText(err), 'err')
    }
  }

  return (
    <>
      <PageHeader
        title={t('nav.staff')}
        subtitle={t('staff.subtitle')}
        actions={
          isOwner && (
            <Button onClick={() => setAdding(true)}>
              <MqPlus className="h-4 w-4" />
              {t('staff.add')}
            </Button>
          )
        }
      />
      <Card bodyClass="">
        {loading && !data ? (
          <Skeleton className="px-6" />
        ) : (
          <ul className="divide-y divide-line">
            {data?.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <Avatar name={s.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {s.name} {s.id === me.user.id && <span className="text-xs font-normal text-muted">({t('staff.you')})</span>}
                  </p>
                  <p className="truncate text-xs text-muted" dir="ltr">
                    {s.email}
                  </p>
                </div>
                <span className="hidden text-xs text-muted sm:inline">{t('staff.joined', { date: day(s.joinedAt, locale) })}</span>
                {isOwner && s.id !== me.user.id ? (
                  <>
                    <label className="w-40">
                      <span className="sr-only">{t('staff.role')}</span>
                      <Select value={s.role} onChange={(e) => changeRole(s, e.target.value)} className="!min-h-10">
                        {['owner', ...ASSIGNABLE].map((r) => (
                          <option key={r} value={r}>
                            {t(`roles.${r}`)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Button variant="ghost" size="sm" onClick={() => remove(s)} aria-label={t('staff.remove', { name: s.name })}>
                      <MqTrash className="h-4 w-4 text-err" />
                    </Button>
                  </>
                ) : (
                  <RoleBadge role={s.role} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && (
        <AddStaff
          onClose={() => setAdding(false)}
          onAdded={() => {
            toast(t('staff.added'))
            reload()
          }}
        />
      )}
    </>
  )
}
