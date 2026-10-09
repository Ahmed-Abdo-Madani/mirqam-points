/* Thin fetch wrapper for the same-origin API (cookie session).
   Every write sends JSON (the server's CSRF guard requires it). Ledger writes
   pass `idempotencyKey` — reuse the same key when retrying the same action. */
import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  constructor(status, code, body) {
    super(code)
    this.status = status
    this.code = code
    this.body = body
  }
}

export const UNAUTHENTICATED_EVENT = 'mp:unauthenticated'

export async function api(path, { method = 'GET', body, idempotencyKey, signal } = {}) {
  const headers = { accept: 'application/json' }
  const write = method !== 'GET'
  if (write) headers['content-type'] = 'application/json'
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: write ? JSON.stringify(body ?? {}) : undefined,
      credentials: 'same-origin',
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError(0, 'network_error')
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/me' && path !== '/auth/login') window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
    throw new ApiError(res.status, data?.error || 'http_error', data)
  }
  return data
}

export const newKey = () => crypto.randomUUID()

/* One idempotency key per distinct request. Retrying the same request reuses
   the key (the server replays instead of double-posting); changing anything in
   the request — the fingerprint — yields a fresh key during that same render,
   so a fast submit can never pair an old key with a new payload. */
export function useIdempotencyKey(fingerprint) {
  const ref = useRef(null)
  if (!ref.current || ref.current.fingerprint !== fingerprint) ref.current = { fingerprint, key: newKey() }
  return {
    key: ref.current.key,
    /** Call after success so an identical follow-up request is a new transaction. */
    rotate: () => {
      ref.current = { fingerprint, key: newKey() }
    },
  }
}

/** GET with loading/error state; `reload()` refetches. Pass null to skip. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) })
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload trigger.
  useEffect(() => {
    if (!path) return undefined
    const ctrl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    api(path, { signal: ctrl.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }))
      })
    return () => ctrl.abort()
  }, [path, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload }
}
