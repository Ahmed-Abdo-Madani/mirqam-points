import { useI18n } from '../i18n/index.jsx'

/* "Accepted payment methods" strip for the public footer (website only).
   Live methods only: mada, Visa, Mastercard, Apple Pay, Tamara. The files in
   /public/payment-methods are the official brand artwork copied byte-for-byte
   from the Mirqam billing assets — never redraw, recolour, crop or stretch
   them. The chips are deliberately literal white (not a theme token) so each
   mark keeps its brand colours in dark mode; width/height reserve the box and
   CSS only sets the height. */
const METHODS = [
  { key: 'mada', src: '/payment-methods/mada.svg', w: 96, h: 64 },
  { key: 'visa', src: '/payment-methods/visa.svg', w: 96, h: 64 },
  { key: 'mastercard', src: '/payment-methods/mastercard.svg', w: 96, h: 64 },
  { key: 'applePay', src: '/payment-methods/apple-pay.png', w: 260, h: 140 },
]

export default function PaymentMethods() {
  const { t, locale } = useI18n()
  const items = [
    ...METHODS,
    {
      key: 'tamara',
      src: locale === 'ar' ? '/payment-methods/tamara-ar.png' : '/payment-methods/tamara.png',
      w: 296,
      h: 96,
    },
  ]
  return (
    <section aria-labelledby="footer-payment-methods" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p id="footer-payment-methods" className="text-sm font-semibold text-ink">
        {t('footer.paymentMethods')}
      </p>
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((m) => (
          <li key={m.key} className="flex items-center rounded-lg border border-line bg-white px-1.5 py-1">
            <img src={m.src} alt={t(`footer.pay.${m.key}`)} width={m.w} height={m.h} loading="lazy" decoding="async" className="h-5 w-auto sm:h-7" />
          </li>
        ))}
      </ul>
    </section>
  )
}
