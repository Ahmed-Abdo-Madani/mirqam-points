import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, NATIVE, sessionToken, UNAUTHENTICATED_EVENT } from './api.js'

const SessionCtx = createContext(null)

/* Role capabilities — mirrors the server's requireRole gates (server is authoritative). */
const CAN = {
  manage: ['owner', 'manager'], // programs, adjust, void, view staff
  transact: ['owner', 'manager', 'cashier'], // enroll, earn, redeem
  owner: ['owner'], // staff management
}

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null })

  const refresh = useCallback(async () => {
    if (NATIVE && !sessionToken.get()) return setState({ status: 'anon', me: null })
    try {
      setState({ status: 'auth', me: await api('/auth/me') })
    } catch {
      setState({ status: 'anon', me: null })
    }
  }, [])

  useEffect(() => {
    refresh()
    const onExpired = () => {
      sessionToken.clear()
      setState({ status: 'anon', me: null })
    }
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired)
  }, [refresh])

  const value = {
    ...state,
    /* The native app receives its bearer token in the sign-in response. */
    signedIn: ({ token, ...me }) => {
      sessionToken.set(token)
      setState({ status: 'auth', me })
    },
    /** Re-reads the workspace (e.g. after the logo changes). */
    refresh,
    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => {})
      sessionToken.clear()
      setState({ status: 'anon', me: null })
    },
    /** After account deletion: the session no longer exists server-side. */
    forget() {
      sessionToken.clear()
      setState({ status: 'anon', me: null })
    },
    can: (capability) => Boolean(state.me && CAN[capability]?.includes(state.me.role)),
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export const useSession = () => useContext(SessionCtx)
