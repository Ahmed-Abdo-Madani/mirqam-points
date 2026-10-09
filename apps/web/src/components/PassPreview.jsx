/* Visual approximation of a wallet pass, in the program's pass colours
   (the same design the Apple and Google renderers use). */
import { MqQrCode } from '@mirqam/ui'
import { num } from '../lib/format.js'

export default function PassPreview({ merchant, programName, type = 'points', balance = 0, stampsRequired = 10, memberName, labels, design, className = '' }) {
  const style = design ? { '--pass-bg': design.background, '--pass-fg': design.foreground, '--pass-label': design.label } : undefined
  return (
    <div className={`mp-pass w-full max-w-[340px] overflow-hidden ${className}`} dir="ltr" style={style}>
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-sm font-bold">{merchant?.[0] ?? 'M'}</span>
        <div className="text-right" dir="auto">
          <small className="block text-[10px] font-semibold uppercase tracking-wider">{labels.balance}</small>
          <span className="tnum text-2xl font-bold">{num(balance)}</span>
        </div>
      </div>
      <div className="mt-4 border-y border-white/10 bg-white/[0.04] px-5 py-4" dir="auto">
        <p className="text-lg font-bold leading-snug">{merchant}</p>
        <small className="text-xs">{programName}</small>
        {type === 'stamps' && (
          <div className="mt-3 flex flex-wrap gap-2" aria-hidden="true">
            {Array.from({ length: stampsRequired }, (_, i) => (
              <span key={i} className={`h-4 w-4 rotate-45 rounded-[4px] border ${i < balance ? 'border-brand-300 bg-brand-400' : 'border-white/30'}`} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-4 px-5 py-5">
        <div dir="auto">
          <small className="block text-[10px] font-semibold uppercase tracking-wider">{labels.member}</small>
          <span className="text-sm font-semibold">{memberName}</span>
        </div>
        <span className="rounded-xl bg-white p-2 text-navy-900">
          <MqQrCode className="h-14 w-14" strokeWidth={2.6} />
        </span>
      </div>
    </div>
  )
}
