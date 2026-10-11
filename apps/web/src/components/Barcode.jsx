import { useEffect, useState } from 'react'
import Qr from './Qr.jsx'

const BCID = { pdf417: 'pdf417', aztec: 'azteccode', code128: 'code128' }

/* Any of the wallet barcode types, rendered locally. QR keeps the lightweight
   encoder; the others load bwip-js on demand so the console bundle stays small. */
export default function Barcode({ format = 'qr', value, size = 180, label, className = '' }) {
  const [svg, setSvg] = useState(null)
  useEffect(() => {
    if (!BCID[format]) return
    let alive = true
    import('bwip-js/browser').then((bwip) => {
      if (!alive) return
      try {
        setSvg(
          bwip.toSVG({
            bcid: BCID[format],
            text: value,
            scale: 2,
            ...(format === 'aztec' ? {} : { height: format === 'pdf417' ? 8 : 12 }),
            includetext: false,
          }),
        )
      } catch {
        setSvg(null)
      }
    })
    return () => {
      alive = false
    }
  }, [format, value])
  if (!BCID[format]) return <Qr value={value} size={size} label={label} className={className} />
  return (
    <span className={`inline-block rounded-2xl bg-white p-2.5 ${className}`} role="img" aria-label={label}>
      {svg ? (
        <span
          className="block [&>svg]:h-auto [&>svg]:max-h-32 [&>svg]:w-full"
          style={{ width: format === 'aztec' ? size * 0.7 : size }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG produced locally by bwip-js from the card code
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span className="block h-16" style={{ width: size }} />
      )}
    </span>
  )
}
