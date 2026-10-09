import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR code rendered locally (no third-party service sees pass links). */
export default function Qr({ value, size = 200, label, className = '' }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#172740', light: '#ffffff' } }).then(
      (url) => alive && setSrc(url),
    )
    return () => {
      alive = false
    }
  }, [value, size])
  return (
    <span className={`inline-block rounded-2xl bg-white p-2.5 ${className}`}>
      {src ? <img src={src} width={size} height={size} alt={label} /> : <span style={{ width: size, height: size }} className="block" />}
    </span>
  )
}
