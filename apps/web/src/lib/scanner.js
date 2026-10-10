/* Camera scanning of wallet-pass and gift-card barcodes in the native app
   (Capacitor's official barcode scanner: its own full-screen camera UI and
   permission prompt on iOS and Android). The plugin is loaded lazily so the
   web console bundle does not carry it. */
import { Capacitor } from '@capacitor/core'

export const canScan = () => Capacitor.isNativePlatform()

export class ScanError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** Opens the scanner; resolves with the raw barcode value, or null if cancelled. */
export async function scanCode() {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner')
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.ALL })
    return result?.ScanResult || null
  } catch (err) {
    const message = String(err?.message || err)
    if (/cancel/i.test(message)) return null
    if (/permission|denied|camera/i.test(message)) throw new ScanError('camera_denied')
    throw err
  }
}
