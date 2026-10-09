/* Mirqam UI primitives — ported from Mirqam Bot `components/ui`, made
   locale-neutral (labels are props) and theme-aware (semantic tokens only). */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { MqCheckCircle, MqChevronDown, MqLoader, MqX, MqXCircle } from './icons.jsx'
import { useDismiss } from './useDismiss.js'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/* ---------- Button ---------- */
const buttonVariants = {
  /* Brand rule: primary action = navy; teal stays for active/links/focus. */
  primary: 'bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-50',
  outline: 'border border-line bg-surface text-ink hover:border-brand-500 hover:text-accent disabled:opacity-50',
  ghost: 'text-muted hover:bg-soft hover:text-ink disabled:opacity-50',
  danger: 'bg-err text-white hover:bg-err-deep disabled:opacity-50 dark:text-navy-950',
}
const buttonSizes = { sm: 'min-h-9 px-3 text-xs', md: 'min-h-11 px-4 text-sm', lg: 'min-h-12 px-6 text-base' }

export function Button({ variant = 'primary', size = 'md', loading = false, className = '', children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold transition',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...rest}
      /* After the spread: a caller's disabled={false} must not cancel the loading guard (double-submit). */
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
    >
      {loading && <MqLoader className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

/* ---------- Card ---------- */
export function Card({ title, subtitle, action, className = '', bodyClass = 'p-5', children, as: Tag = 'section' }) {
  return (
    <Tag className={cx('mq-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            {title && <h2 className="text-[17px] font-bold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </Tag>
  )
}

/* ---------- Badge ---------- */
const badgeTones = {
  green: 'bg-ok-bg text-ok border-ok/20',
  blue: 'bg-info-bg text-info border-info/20',
  amber: 'bg-warn-bg text-warn border-warn/20',
  red: 'bg-err-bg text-err border-err/20',
  teal: 'bg-tint text-accent border-brand-500/20',
  gray: 'bg-soft text-muted border-line',
}

export function Badge({ tone = 'gray', className = '', children }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', badgeTones[tone], className)}
    >
      {children}
    </span>
  )
}

/* ---------- Form controls ---------- */
export function Input({ className = '', ...rest }) {
  return <input className={cx('input-base', className)} {...rest} />
}

export function Textarea({ className = '', ...rest }) {
  return <textarea className={cx('input-base resize-y', className)} {...rest} />
}

/* Native select (accessible, mobile-friendly) with a logical-side chevron that flips with dir. */
export function Select({ className = '', children, ...rest }) {
  return (
    <span className="relative block">
      <select className={cx('input-base cursor-pointer appearance-none pe-10', className)} {...rest}>
        {children}
      </select>
      <MqChevronDown className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </span>
  )
}

/** Label + control + hint/error. Pass the control as children; ids and aria wiring are automatic. */
export function Field({ label, hint, error, children, className = '' }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const control = typeof children === 'function' ? children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }) : children
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {control}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-err">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/* ---------- Modal (enter scale-only / exit 220ms ease-in) ---------- */
export function Modal({ open, onClose, title, children, footer, size = 'md', closeLabel = 'إغلاق' }) {
  const ref = useRef(null)
  const titleId = useId()
  const [phase, setPhase] = useState(open ? 'in' : 'closed')
  useEffect(() => {
    if (open) setPhase('in')
    else setPhase((p) => (p === 'closed' ? p : 'out'))
  }, [open])
  useEffect(() => {
    if (phase !== 'out') return undefined
    const t = setTimeout(() => setPhase('closed'), 230)
    return () => clearTimeout(t)
  }, [phase])
  useEffect(() => {
    if (open) ref.current?.querySelector('input, select, textarea, button:not([data-close])')?.focus()
  }, [open])
  useDismiss(ref, onClose, open)
  if (phase === 'closed') return null
  const out = phase === 'out'
  const width = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' }[size]
  /* No backdrop-blur: a freshly mounted backdrop-filter flashes in Chromium. */
  return (
    <div className={cx('no-print fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/50 p-4', out && 'backdrop-out')}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(out ? 'modal-out' : 'modal-in', 'w-full rounded-[var(--radius-card)] border border-line bg-surface shadow-pop', width)}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h3 id={titleId} className="text-base font-bold">
            {title}
          </h3>
          <button
            type="button"
            data-close
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-soft hover:text-ink"
            aria-label={closeLabel}
          >
            <MqX className="h-5 w-5" />
          </button>
        </header>
        <div className="max-h-[68vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  )
}

/* ---------- Dropdown menu ---------- */
export function Menu({ button, items, header, align = 'end' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, close, open)
  return (
    <div className="relative" ref={ref}>
      {button({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cx(
            'fade-in absolute top-full z-40 mt-2 min-w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-pop',
            align === 'end' ? 'end-0' : 'start-0',
          )}
        >
          {header && <div className="mb-1 border-b border-line px-3 pb-2.5 pt-1.5">{header}</div>}
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                it.onClick?.()
              }}
              className={cx(
                'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start text-sm transition hover:bg-soft',
                it.danger ? 'text-err' : 'text-ink',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon: Icon, title, desc, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      {Icon && (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-sm font-bold">{title}</p>
      {desc && <p className="max-w-sm text-xs leading-relaxed text-muted">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ---------- Skeleton ---------- */
export function Skeleton({ label = 'جارٍ التحميل…', rows = 1, className = '' }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mq-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  )
}

/* ---------- Stat tile (KPI) ---------- */
export function Stat({ label, value, hint, icon: Icon, tone = 'teal' }) {
  const tones = { teal: 'bg-tint text-accent', amber: 'bg-warn-bg text-warn', green: 'bg-ok-bg text-ok', navy: 'bg-soft text-ink' }
  return (
    <div className="mq-card flex items-start justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="tnum mt-1.5 truncate text-[26px] font-bold leading-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {Icon && (
        <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      )}
    </div>
  )
}

/* ---------- Avatar ---------- */
const AVATAR_COLORS = ['#177e83', '#274b6e', '#23949a', '#3b6288', '#0f6f74', '#1e3a57', '#54818a', '#172740']

export function Avatar({ name, fallback = '؟', size = 40, className = '' }) {
  const label = String(name || fallback).trim()
  const initials =
    label
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('') || fallback
  let hash = 0
  for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden="true"
      className={cx('flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white', className)}
      style={{ width: size, height: size, backgroundColor: AVATAR_COLORS[hash % AVATAR_COLORS.length], fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </span>
  )
}

/* ---------- Toast ---------- */
const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const show = useCallback((text, tone = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3550)
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="no-print fixed bottom-5 end-5 z-[90] flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              t.leaving ? 'toast-out' : 'toast-in',
              'flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium shadow-pop',
              t.tone === 'err' ? 'border-err/20 bg-err-bg text-err' : 'border-transparent bg-navy-950 text-white',
            )}
          >
            {t.tone === 'err' ? <MqXCircle className="h-5 w-5 shrink-0" /> : <MqCheckCircle className="h-5 w-5 shrink-0 text-brand-400" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
