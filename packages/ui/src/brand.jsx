/* Brand components shared by every Mirqam product. */
import { useEffect, useId, useState } from 'react'
import { MqMoon, MqSun } from './icons.jsx'

/** Mirqam wordmark + product label. Day/night variants swap with the theme
    (or always-night with `inverse` on deliberate dark panels). */
export function Logo({
  label,
  sublabel,
  inverse = false,
  className = 'h-12',
  srcDay = '/brand/mirqam-light.svg',
  srcNight = '/brand/mirqam-dark.svg',
  alt = 'مرقام',
}) {
  return (
    <span className={`mq-logo ${inverse ? 'mq-logo-inverse' : ''} ${className}`}>
      <img className="mq-logo-day" src={srcDay} alt={alt} draggable={false} />
      <img className="mq-logo-night" src={srcNight} alt={alt} draggable={false} />
      {label && (
        <span className="mq-logo-label" aria-hidden="true">
          {label}
          {sublabel && <span>{sublabel}</span>}
        </span>
      )}
    </span>
  )
}

/** Decorative pattern layer at 5–18% opacity. Parent must be `relative overflow-hidden`. */
export function Pattern({ variant = 'waves', opacity = 0.12, className = '' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const cls = `mq-pattern pointer-events-none absolute inset-0 h-full w-full ${className}`
  if (variant === 'diamonds') {
    return (
      <svg aria-hidden="true" focusable="false" className={cls} style={{ opacity }}>
        <defs>
          <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect x="19" y="19" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" focusable="false" className={cls} style={{ opacity }} viewBox="0 0 1440 600" fill="none" preserveAspectRatio="none">
      <circle className="mq-orbit" cx="1060" cy="220" r="150" stroke="currentColor" strokeWidth="1" strokeDasharray="5 12" />
      <rect className="mq-square" x="200" y="100" width="85" height="85" rx="14" stroke="currentColor" strokeWidth="2" />
      <rect className="mq-square mq-square-second" x="1170" y="370" width="55" height="55" rx="10" stroke="currentColor" strokeWidth="2" />
      <path d="M0 440c240-60 480-60 720 0s480 60 720 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M0 490c240-60 480-60 720 0s480 60 720 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M0 540c240-60 480-60 720 0s480 60 720 0" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/* Theme: light by default, dark is an explicit persistent choice (same key as Mirqam Bot). */
const THEME_KEY = 'mirqam-theme'

export function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* storage is optional */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => applyTheme(theme), [theme])
  return [theme, setTheme]
}

export function ThemeToggle({ labels = { toDark: 'المظهر الداكن', toLight: 'المظهر الفاتح' }, className = '' }) {
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  const label = dark ? labels.toLight : labels.toDark
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-muted transition hover:text-ink ${className}`}
    >
      {dark ? <MqSun className="h-[18px] w-[18px]" /> : <MqMoon className="h-[18px] w-[18px]" />}
    </button>
  )
}

/** Official commercial identity — required on every public page (Meta/WhatsApp
    business verification cross-checks it). Bilingual by design. */
export function CompanyIdentity({ email = 'contact.bot@mirqam.sa' }) {
  const cell = 'bg-surface px-5 py-3.5 text-center'
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
      <div className={cell}>
        <p className="text-[10px] font-bold text-faint">الاسم الرسمي / Legal name</p>
        <p className="mt-1 text-xs font-extrabold">شركة مرقام التجارية</p>
        <p dir="ltr" className="mt-0.5 text-[10.5px] text-muted">
          Mirqam Company Commercial
        </p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-bold text-faint">السجل التجاري / CR No.</p>
        <p dir="ltr" className="tnum mt-1 text-xs font-extrabold">
          7055011105
        </p>
        <p className="mt-0.5 text-[10.5px] text-muted">الرقم الوطني الموحد / Unified National No.</p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-bold text-faint">التواصل / Contact</p>
        <a href={`mailto:${email}`} dir="ltr" className="mt-1 block text-xs font-extrabold transition hover:text-accent">
          {email}
        </a>
      </div>
      <div className={`${cell} sm:col-span-3`}>
        <p className="text-[10px] font-bold text-faint">العنوان المسجل / Registered address</p>
        <p className="mt-1 text-[11.5px] font-semibold leading-relaxed">
          مبنى 8145، شارع المصيف 54، حي المصيف، الرمز البريدي 39913، حفر الباطن، المملكة العربية السعودية
        </p>
        <p dir="ltr" className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
          Building 8145, Al Masif 54 St., Al Masif Dist., Postal Code 39913, Hafar Al Batin, Kingdom of Saudi Arabia
        </p>
      </div>
    </div>
  )
}
