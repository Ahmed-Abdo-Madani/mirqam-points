/* Visual approximation of a wallet pass, driven by the same normalised design
   the Apple and Google renderers use (layout, colours, stamp shape, fields). */
import { MqQrCode } from '@mirqam/ui'
import { assetUrl } from '../lib/api.js'
import { num } from '../lib/format.js'

/* Stamp glyphs share one 24px viewBox; filled ones are solid, the rest faded. */
const SHAPES = {
  circle: <circle cx="12" cy="12" r="9" />,
  square: <rect x="3.5" y="3.5" width="17" height="17" rx="5" />,
  star: <path d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5l-5.9 3.3 1.3-6.7L2.5 9.5l6.6-.8z" />,
  heart: <path d="M12 21s-8.5-5.2-8.5-11A4.7 4.7 0 0 1 12 7.4 4.7 4.7 0 0 1 20.5 10c0 5.8-8.5 11-8.5 11z" />,
}

function Stamps({ total, filled, shape, color, image }) {
  const rows = total <= 6 ? 1 : Math.ceil(total / 7)
  const perRow = Math.ceil(total / rows)
  return (
    <div className="grid justify-center gap-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex justify-center gap-3">
          {Array.from({ length: Math.min(perRow, total - r * perRow) }, (_, c) => (
            shape === 'custom' && image ? (
              <img key={c} src={image} alt="" className="h-7 w-7 object-contain" style={{ opacity: r * perRow + c < filled ? 1 : 0.27 }} />
            ) : (
              <svg key={c} viewBox="0 0 24 24" role="presentation" className="h-7 w-7" fill={color} fillOpacity={r * perRow + c < filled ? 1 : 0.27}>
                {SHAPES[shape] ?? SHAPES.circle}
              </svg>
            )
          ))}
        </div>
      ))}
    </div>
  )
}

export default function PassPreview({
  merchant,
  programName,
  type = 'points',
  balance = 0,
  stampsRequired = 10,
  memberName,
  lifetime = 0,
  code = 'A1B2C3D4E5',
  labels,
  design,
  logoUrl,
  side = 'front',
  stampImage = null,
  className = '',
}) {
  const d = {
    layout: 'classic',
    stampColor: design?.label,
    stampShape: 'circle',
    barcode: 'qr',
    front: ['member'],
    back: ['code', 'reward', 'terms', 'link'],
    notes: [],
    ...design,
  }
  const stamps = type === 'stamps'
  const layout = d.layout === 'strip' && !stamps ? 'classic' : d.layout
  const style = { '--pass-bg': d.background, '--pass-fg': d.foreground, '--pass-label': d.label }
  const remaining = stamps ? Math.max(stampsRequired - balance, 0) : null
  const fields = {
    member: [labels.member, memberName],
    remaining: remaining == null ? null : [labels.remaining, remaining === 0 ? labels.rewardReady : num(remaining)],
    lifetime: [labels.lifetime, num(lifetime)],
    code: [labels.code, code],
  }
  const shown = (d.front ?? []).map((k) => fields[k]).filter(Boolean)
  const balanceText = stamps ? `${num(balance)} / ${num(stampsRequired)}` : num(balance)
  const logo = logoUrl ? (
    <img src={assetUrl(logoUrl)} alt="" className="h-9 w-9 rounded-xl object-contain" />
  ) : (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-sm font-bold">{merchant?.[0] ?? 'M'}</span>
  )

  if (side === 'back') {
    const rows = []
    for (const k of d.back ?? []) {
      if (k === 'code') rows.push([labels.code, code])
      if (k === 'reward' && d.rewardText) rows.push([labels.reward, d.rewardText])
      if (k === 'terms') rows.push([labels.terms, labels.termsText])
      if (k === 'link') rows.push([labels.link, 'loyalty.mirqam.sa/p/…'])
    }
    for (const n of d.notes ?? []) rows.push([n.label, n.value])
    for (const l of d.locations ?? []) if (l.name) rows.push([l.name, labels.directions ?? 'Google Maps'])
    return (
      <div className={`mp-pass w-full max-w-[340px] overflow-hidden ${className}`} dir="auto" style={style}>
        <p className="px-5 pt-5 text-sm font-bold">{merchant}</p>
        <dl className="grid gap-3 px-5 py-5">
          {rows.map(([k, v], i) => (
            <div key={i} className="border-t border-white/10 pt-3 first:border-0 first:pt-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider">{k}</dt>
              <dd className="mt-0.5 break-words text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  return (
    <div className={`mp-pass w-full max-w-[340px] overflow-hidden ${className}`} dir="ltr" style={style}>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <span className="flex items-center gap-2">
          {logo}
          <span className="text-sm font-bold" dir="auto">
            {merchant}
          </span>
        </span>
        {layout !== 'balance' && (
          <div className="text-right" dir="auto">
            <small className="block text-[10px] font-semibold uppercase tracking-wider">{labels.balance}</small>
            <span className="tnum text-xl font-bold">{balanceText}</span>
          </div>
        )}
      </div>
      {layout === 'strip' ? (
        <div className="mt-3 py-3">
          <Stamps total={Math.min(stampsRequired, 21)} filled={balance} shape={d.stampShape} color={d.stampColor} image={stampImage} />
        </div>
      ) : (
        <div className="mt-4 border-y border-white/10 bg-white/[0.04] px-5 py-4" dir="auto">
          {layout === 'balance' ? (
            <>
              <small className="block text-[10px] font-semibold uppercase tracking-wider">{labels.balance}</small>
              <span className="tnum text-4xl font-bold leading-tight">{balanceText}</span>
              <small className="mt-1 block text-xs">{programName}</small>
            </>
          ) : (
            <>
              <p className="text-lg font-bold leading-snug">{programName}</p>
              {stamps && (
                <div className="mt-3">
                  <Stamps total={Math.min(stampsRequired, 21)} filled={balance} shape={d.stampShape} color={d.stampColor} image={stampImage} />
                </div>
              )}
            </>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 px-5 pt-4" dir="auto">
          {shown.map(([k, v], i) => (
            <div key={i}>
              <small className="block text-[10px] font-semibold uppercase tracking-wider">{k}</small>
              <span className="text-sm font-semibold">{v}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-center px-5 py-5">
        <span className="flex items-center justify-center rounded-xl bg-white p-2 text-navy-900">
          {d.barcode === 'qr' ? (
            <MqQrCode className="h-14 w-14" strokeWidth={2.6} />
          ) : (
            <span
              className="block h-14 w-44 bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_5px,currentColor_5px_6px,transparent_6px_9px)]"
              aria-hidden="true"
            />
          )}
        </span>
      </div>
    </div>
  )
}
