import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('native website-only billing boundary', () => {
  it.each([
    ['/billing', 'GET'],
    ['/billing/checkout', 'POST'],
    ['/billing/checkout/session/confirm', 'POST'],
    ['/billing/coupon', 'POST'],
    ['/billing/payment-method', 'POST'],
    ['/billing/cancel', 'POST'],
    ['/billing/resume', 'POST'],
    ['/billing/state', 'POST'],
    ['/billing/checkout?cycle=yearly', 'GET'],
  ])('blocks %s %s before credentials or network access', async (path, method) => {
    vi.stubEnv('VITE_NATIVE', '1')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => { throw new Error('credentials accessed') }) })
    const { api } = await import('./api.js')
    await expect(api(path, { method })).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    expect(fetch).not.toHaveBeenCalled()
    expect(localStorage.getItem).not.toHaveBeenCalled()
  })

  it.each([['1', '/billing/state', 'GET'], ['1', '/members', 'GET'], ['0', '/billing/checkout', 'POST']])(
    'retains permitted native=%s path=%s method=%s requests', async (native, path, method) => {
      vi.stubEnv('VITE_NATIVE', native)
      vi.stubGlobal('localStorage', { getItem: () => null })
      const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fixture: true }) }))
      vi.stubGlobal('fetch', fetch)
      const { api } = await import('./api.js')
      await expect(api(path, { method })).resolves.toEqual({ fixture: true })
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0][0]).toContain('/api' + path)
    },
  )
})
