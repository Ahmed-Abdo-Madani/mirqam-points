import { Badge, Button, Card, Field, Input, Modal } from '@mirqam/ui'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader, RoleBadge } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, useApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.jsx'

/* In-app account deletion (App Store guideline 5.1.1(v)): no email round-trip, password-confirmed. */
function DeleteAccount() {
  const { t } = useI18n()
  const errorText = useErrorText()
  const { me, forget } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await api('/auth/delete-account', { method: 'POST', body: { password } })
      forget()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('settings.deleteTitle')} subtitle={t('settings.deleteSubtitle')}>
      <p className="text-sm leading-relaxed text-muted">{t(me.role === 'owner' ? 'settings.deleteOwnerBody' : 'settings.deleteStaffBody')}</p>
      <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
        {t('settings.deleteButton')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings.deleteConfirmTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy} disabled={!password}>
              {t('settings.deleteForever')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('settings.deleteConfirmBody')}</p>
        <Field label={t('auth.password')} className="mt-4">
          {(p) => <Input {...p} type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
        </Field>
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
            {errorText(error)}
          </p>
        )}
      </Modal>
    </Card>
  )
}

export default function Settings() {
  const { t } = useI18n()
  const { me } = useSession()
  const wallet = useApi('/wallet/status')
  const status = (on) => <Badge tone={on ? 'green' : 'amber'}>{t(on ? 'settings.connected' : 'settings.notConnected')}</Badge>
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={t('settings.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('settings.account')}>
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('auth.name')}</dt>
              <dd className="font-semibold">{me.user.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('auth.email')}</dt>
              <dd className="font-semibold" dir="ltr">
                {me.user.email}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('settings.workspace')}</dt>
              <dd className="font-semibold">{me.tenant.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('staff.role')}</dt>
              <dd>
                <RoleBadge role={me.role} />
              </dd>
            </div>
          </dl>
        </Card>
        <Card title={t('settings.wallets')} subtitle={t('settings.walletsSubtitle')}>
          <ul className="grid gap-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span className="font-semibold">Apple Wallet</span>
              {wallet.data && status(wallet.data.apple)}
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="font-semibold">Google Wallet</span>
              {wallet.data && status(wallet.data.google)}
            </li>
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted">{t('settings.walletsNote')}</p>
        </Card>
        <Card title={t('settings.legal')}>
          <nav className="flex flex-wrap gap-4 text-sm font-semibold text-accent">
            <Link to="/privacy">{t('legal.privacy')}</Link>
            <Link to="/terms">{t('legal.terms')}</Link>
            <Link to="/support">{t('legal.support')}</Link>
          </nav>
        </Card>
        <DeleteAccount />
      </div>
    </>
  )
}
