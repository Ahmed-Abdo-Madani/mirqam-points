import { Badge, Button, Card, Field, Input, Modal, useToast } from '@mirqam/ui'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader, RoleBadge } from '../../components/AppShell.jsx'
import { useErrorText, useI18n } from '../../i18n/index.jsx'
import { api, assetUrl, useApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.jsx'

/* In-app account deletion (App Store guideline 5.1.1(v)): no email round-trip, confirmed by password or a recent social login. */
function DeleteAccount() {
  const { t } = useI18n()
  const errorText = useErrorText()
  const { me, forget } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function confirm(socialConfirmation = false) {
    setBusy(true)
    setError(null)
    try {
      await api('/auth/delete-account', { method: 'POST', body: socialConfirmation ? { socialConfirmation: true } : { password } })
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
            <Button variant="danger" onClick={() => confirm()} loading={busy} disabled={!password}>
              {t('settings.deleteForever')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('settings.deleteConfirmBody')}</p>
        <Field label={t('auth.password')} className="mt-4">
          {(p) => <Input {...p} type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
        </Field>
        {me.socialProviders?.length > 0 && (
          <div className="mt-4 grid gap-3">
            {me.recentSocialLogin ? (
              <Button variant="danger" onClick={() => confirm(true)} loading={busy}>{t('settings.deleteSocialConfirm')}</Button>
            ) : (
              <>
                <p className="text-sm text-muted">{t('settings.deleteSocialAgain')}</p>
                {me.socialProviders.filter((p) => ['google', 'github'].includes(p)).map((provider) => (
                  <a key={provider} href={'/api/auth/social/' + provider} className="text-accent underline">{t(provider === 'google' ? 'auth.google' : 'auth.github')}</a>
                ))}
              </>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-err/20 bg-err-bg px-4 py-3 text-sm text-err">
            {errorText(error)}
          </p>
        )}
      </Modal>
    </Card>
  )
}

/* Reads the chosen image, scales it to at most 512px and re-encodes it as PNG
   (the only format wallets and the API accept), so any PNG/JPG/WebP works. */
async function toLogoPng(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(48, Math.round(bitmap.width * scale))
  canvas.height = Math.max(48, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function Logo() {
  const { t } = useI18n()
  const errorText = useErrorText()
  const toast = useToast()
  const { me, refresh, can } = useSession()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  async function run(fn, done) {
    setBusy(true)
    try {
      await fn()
      await refresh()
      toast(t(done))
    } catch (err) {
      toast(err?.code || err?.status ? errorText(err) : t('design.logoFailed'), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t('design.logoTitle')} subtitle={t('design.logoSubtitle')}>
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-tint text-lg font-bold">
          {me.tenant.logoUrl ? <img src={assetUrl(me.tenant.logoUrl)} alt="" className="h-full w-full object-contain" /> : me.tenant.name[0]}
        </span>
        <p className="text-xs leading-relaxed text-muted">{t('design.logoHint')}</p>
      </div>
      {can('manage') && (
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) run(async () => api('/branding/logo', { method: 'PUT', body: { png: await toLogoPng(file) } }), 'design.logoSaved')
            }}
          />
          <Button variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}>
            {t('design.logoUpload')}
          </Button>
          {me.tenant.logoUrl && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api('/branding/logo', { method: 'DELETE' }), 'design.logoRemoved')}>
              {t('design.logoRemove')}
            </Button>
          )}
        </div>
      )}
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
        <Logo />
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
