import { ToastProvider } from '@mirqam/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { I18nProvider } from './i18n/index.jsx'
import { NATIVE } from './lib/api.js'
import { confirmAppStarted } from './lib/live-update.js'
import { SessionProvider } from './lib/session.jsx'
import './styles.css'

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
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
)
