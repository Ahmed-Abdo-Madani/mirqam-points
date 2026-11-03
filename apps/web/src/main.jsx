import { ToastProvider } from '@mirqam/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { I18nProvider, useI18n } from './i18n/index.jsx'
import { NATIVE } from './lib/api.js'
import { confirmAppStarted } from './lib/live-update.js'
import { SessionProvider } from './lib/session.jsx'
import './styles.css'

function WhatsAppSupport() {
  const { t } = useI18n()
  if (NATIVE) return null
  return (
    <>
      <div className="mirqam-wa-wrap">
        <a className="mirqam-wa" href="https://wa.me/966552090433" target="_blank" rel="noopener noreferrer" aria-label={t('supportButton.label')}>
          <span className="sr-only">{t('supportButton.label')}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.52 3.48A11.89 11.89 0 0 0 12.04 0C5.45 0 .09 5.36.09 11.95c0 2.1.55 4.15 1.6 5.96L0 24l6.25-1.64a11.94 11.94 0 0 0 5.79 1.48h.01C18.63 23.84 24 18.48 24 11.89c0-3.19-1.24-6.18-3.48-8.41ZM12.05 21.82a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.71.97.99-3.61-.24-.37a9.88 9.88 0 0 1-1.52-5.27c0-5.48 4.46-9.94 9.95-9.94a9.88 9.88 0 0 1 7.03 2.92 9.88 9.88 0 0 1 2.91 7.03c0 5.48-4.46 9.94-9.94 9.94Zm5.45-7.45c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.22 1.36.19 1.87.11.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" />
          </svg>
        </a>
        <span className="mirqam-wa-tip">{t('supportButton.tip')}</span>
      </div>
      <style>
        {
          '.mirqam-wa-wrap{position:fixed;bottom:max(26px,env(safe-area-inset-bottom));left:max(26px,env(safe-area-inset-left));z-index:1000;direction:rtl}.mirqam-wa{position:relative;width:64px;height:64px;border:1px solid #ffffff80;border-radius:50%;background:linear-gradient(145deg,#29df78,#12a958);box-shadow:0 10px 28px #12995940,inset 0 2px 2px #ffffff40;display:grid;place-items:center;color:white;cursor:pointer;transition:transform .2s,box-shadow .2s}.mirqam-wa:before,.mirqam-wa:after{content:"";position:absolute;inset:-1px;border-radius:50%;border:1.5px solid #20c76a80;animation:mirqam-wa-pulse 2.8s ease-out infinite;pointer-events:none}.mirqam-wa:after{animation-delay:1.4s}.mirqam-wa:hover{transform:translateY(-3px);box-shadow:0 14px 34px #12995955}.mirqam-wa:focus-visible{outline:3px solid #193247;outline-offset:6px}.mirqam-wa svg{width:35px;height:35px;fill:currentColor}.mirqam-wa-tip{position:absolute;left:80px;bottom:12px;white-space:nowrap;background:#193247;color:white;border-radius:13px;padding:11px 16px;font-size:13px;box-shadow:0 8px 24px #19324715;opacity:0;transform:translateX(-8px);transition:.2s;pointer-events:none}.mirqam-wa-wrap:hover .mirqam-wa-tip,.mirqam-wa-wrap:focus-within .mirqam-wa-tip{opacity:1;transform:none}@keyframes mirqam-wa-pulse{0%{transform:scale(1);opacity:.7}85%,100%{transform:scale(1.65);opacity:0}}@media(prefers-reduced-motion:reduce){.mirqam-wa:before,.mirqam-wa:after{animation:none}.mirqam-wa,.mirqam-wa-tip{transition:none}}@media(max-width:480px){.mirqam-wa-wrap{left:20px;bottom:max(22px,env(safe-area-inset-bottom))}.mirqam-wa{width:58px;height:58px}.mirqam-wa svg{width:32px;height:32px}}\n.mirqam-wa{box-sizing:border-box;text-decoration:none;padding:0;min-width:0}.mirqam-wa-tip{font-family:system-ui,sans-serif}@media print{.mirqam-wa-wrap{display:none!important}}'
        }
      </style>
    </>
  )
}

if (NATIVE) document.documentElement.dataset.native = '1'
// Live updates: tell the app this version of the screens started (else it rolls back).
confirmAppStarted()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
            <WhatsAppSupport />
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
)
