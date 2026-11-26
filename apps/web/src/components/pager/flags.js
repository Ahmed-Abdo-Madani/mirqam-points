/* Mirqam Pager on the landing page. The open owner choices each sit in one constant here.
   - Online purchase is off at launch: the section's buttons are WhatsApp until
     VITE_PAGER_CHECKOUT_ENABLED=true; then the trial opens sign-up and lands on the pager plan.
     Inside the native apps there is never a price or a buy/trial button (PURCHASES_IN_APP).
   - The iPhone lock-screen live card is not released: it shows «قريبًا» and is never in a ✓ list.
   - A Pro business can't switch the pager on by itself yet (Mirqam Admin does it), so the
     "free with Pro" line also says to ask for it (copy in i18n, `pager.freeWithPos`). */
import { PURCHASES_IN_APP } from '../../lib/platform.js'

export const PAGER_CHECKOUT_ENABLED = PURCHASES_IN_APP && import.meta.env?.VITE_PAGER_CHECKOUT_ENABLED === 'true'
export const PAGER_SHOW_PRICES = PURCHASES_IN_APP
export const PAGER_LIVE_CARD_RELEASED = false
export const PAGER_TRIAL_PATH = '/register?product=pager&next=/app/billing'
export const PAGER_WHATSAPP = '966552090433'
export const pagerWhatsappLink = (text) => `https://wa.me/${PAGER_WHATSAPP}?text=${encodeURIComponent(text)}`
