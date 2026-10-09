/* Camera scanning of wallet-pass and gift-card barcodes.
   Native app: ML Kit barcode scanner (Capacitor plugin, registered by name so
   the web bundle carries no native code). Web: not available — typed entry. */
import { Capacitor, registerPlugin } from '@capacitor/core'

const BarcodeScanner = registerPlugin('BarcodeScanner')

export const canScan = () => Capacitor.isNativePlatform()

export class ScanError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** Opens the scanner; resolves with the raw barcode value, or null if cancelled. */
export async function scanCode() {
  const perm = await BarcodeScanner.requestPermissions()
  if (perm.camera !== 'granted' && perm.camera !== 'limited') throw new ScanError('camera_denied')
  if (Capacitor.getPlatform() === 'android') {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    if (!available) {
      // One-time download of Google's scanner module by Play services.
      await BarcodeScanner.installGoogleBarcodeScannerModule()
      throw new ScanError('scanner_installing')
    }
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: ['QR_CODE', 'CODE_128'] })
    return barcodes?.[0]?.rawValue ?? null
  } catch (err) {
    if (/cancel/i.test(String(err?.message))) return null
    throw err
  }
}
