import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import viteConfig from '../../vite.config.js'

const runtime = vi.hoisted(() => ({ native: false, platform: 'web' }))
vi.mock('./api.js', () => ({ get NATIVE() { return runtime.native } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => runtime.platform } }))
afterEach(() => { vi.resetModules() })

describe('merchant account policy', () => {
  it.each([[true, 'ios', false, false], [true, 'android', true, false], [false, 'web', true, true]])(
    'keeps registration and purchases correct for native=%s platform=%s', async (native, platform, registration, purchases) => {
      runtime.native = native
      runtime.platform = platform
      const policy = await import('./platform.js')
      expect(policy.REGISTRATION_IN_APP).toBe(registration)
      expect(policy.PURCHASES_IN_APP).toBe(purchases)
    },
  )
})

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const measurement = readFileSync(new URL('../../public/marketing-consent.js', import.meta.url), 'utf8')
const transform = (mode) => viteConfig({ mode }).plugins.find((p) => p.name === 'mobile-no-marketing-measurement').transformIndexHtml.handler

describe('mobile measurement isolation', () => {
  it('retains application boot but excludes website measurement in mobile HTML', () => {
    const mobile = transform('mobile')(html)
    expect(mobile).toContain('/boot.js')
    expect(mobile).toContain('/src/main.jsx')
    expect(mobile).toContain('id="root"')
    expect(mobile).not.toMatch(/marketing-consent|GTM-WMVG4768|G-EZK7YY6DV3/)
  })
  it('preserves the website HTML unchanged', () => {
    expect(transform('production')(html)).toBe(html)
  })
  it.each(['capacitor:', 'ionic:'])('never touches the document or storage under %s', (protocol) => {
    const blocked = () => { throw new Error('native measurement attempted') }
    const context = { location: { protocol, hostname: 'localhost', pathname: '/' }, window: {} }
    Object.defineProperty(context, 'document', { get: blocked })
    Object.defineProperty(context, 'localStorage', { get: blocked })
    expect(() => runInNewContext(measurement, context)).not.toThrow()
  })
  it('also blocks the native bridge on an HTTPS WebView', () => {
    const context = { location: { protocol: 'https:', hostname: 'localhost', pathname: '/' }, window: { Capacitor: { isNativePlatform: () => true } } }
    Object.defineProperty(context, 'document', { get() { throw new Error('native measurement attempted') } })
    expect(() => runInNewContext(measurement, context)).not.toThrow()
  })
})
