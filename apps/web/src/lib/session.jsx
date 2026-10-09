import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, UNAUTHENTICATED_EVENT } from './api.js'

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
    try {
      setState({ status: 'auth', me: await api('/auth/me') })
    } catch {
      setState({ status: 'anon', me: null })
    }
  }, [])

  useEffect(() => {
    refresh()
    const onExpired = () => setState({ status: 'anon', me: null })
    window.addEventListener(UNAUTHENTICATED_EVENT, onExpired)
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onExpired)
  }, [refresh])

  const value = {
    ...state,
    signedIn: (me) => setState({ status: 'auth', me }),
    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => {})
      setState({ status: 'anon', me: null })
    },
    can: (capability) => Boolean(state.me && CAN[capability]?.includes(state.me.role)),
  }
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export const useSession = () => useContext(SessionCtx)
