import { useI18n } from '../../i18n/index.jsx'
import { publicOrigin } from '../../lib/api.js'

/* "Add to wallet" actions. Each button appears only when that platform is
   configured server-side. Apple's link downloads a .pkpass (Safari opens the
   Wallet sheet); Google's redirects to the Save-to-Google-Wallet flow. */
export default function WalletButtons({ wallet }) {
  const { t } = useI18n()
  if (!wallet?.apple && !wallet?.google) return <p className="rounded-2xl bg-soft px-4 py-3 text-center text-sm text-muted">{t('pass.walletSoon')}</p>
  const btn = 'flex min-h-14 items-center justify-center gap-3 rounded-2xl px-5 text-[15px] font-bold transition active:scale-[0.98]'
  return (
    <div className="grid gap-3">
      {wallet.apple && (
        <a href={`${publicOrigin()}${wallet.apple}`} className={`${btn} bg-black text-white hover:bg-neutral-800`} dir="ltr">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
            <path d="M16.37 12.6c.02 2.3 2.02 3.06 2.04 3.07-.02.05-.32 1.09-1.06 2.17-.64.93-1.3 1.86-2.35 1.88-1.03.02-1.36-.61-2.53-.61-1.18 0-1.54.59-2.52.63-1.01.04-1.78-1.01-2.43-1.94-1.32-1.9-2.33-5.38-.97-7.73.67-1.17 1.88-1.91 3.19-1.93.99-.02 1.93.67 2.53.67.61 0 1.75-.83 2.95-.71.5.02 1.91.2 2.81 1.53-.07.05-1.68.98-1.66 2.97ZM14.44 5.08c.54-.65.9-1.56.8-2.46-.77.03-1.71.52-2.27 1.17-.5.58-.94 1.5-.82 2.39.86.07 1.74-.44 2.29-1.1Z" />
          </svg>
          {t('pass.addApple')}
        </a>
      )}
      {wallet.google && (
        <a href={`${publicOrigin()}${wallet.google}`} className={`${btn} border border-line bg-surface text-ink hover:bg-soft`} dir="ltr">
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.97-4.32 2.97-7.33Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.98-.89 6.63-2.42l-3.24-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.81-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC04" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.51H3.06a10 10 0 0 0 0 8.98l3.34-2.58Z" />
            <path
              fill="#EA4335"
              d="M12 5.98c1.47-.02 2.88.53 3.95 1.54l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.94 5.51l3.34 2.58C7.19 7.73 9.4 5.98 12 5.98Z"
            />
          </svg>
          {t('pass.addGoogle')}
        </a>
      )}
    </div>
  )
}
