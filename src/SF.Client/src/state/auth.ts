import { create } from 'zustand'
import type { AccountKind, AuthResponse } from '../api/types'
import { local } from '../lib/storage'

export const AUTH_STORAGE_KEY = 'sf.auth'

export interface AuthSession {
  accountId: string
  displayName: string
  kind: AccountKind
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
}

interface AuthState {
  session: AuthSession | null
  setFromResponse: (response: AuthResponse) => void
  adopt: (session: AuthSession) => void
  clear: () => void
}

function toSession(r: AuthResponse): AuthSession {
  return {
    accountId: r.accountId,
    displayName: r.displayName,
    kind: r.kind,
    accessToken: r.accessToken,
    accessTokenExpiresAt: Date.parse(r.accessTokenExpiresAt),
    refreshToken: r.refreshToken,
  }
}

/**
 * The only credentials the client holds. The refresh token is the guest's sole key to their cloud profile,
 * so it is persisted; the server rotates it on every use and revokes the family if an old one is replayed.
 */
export const useAuth = create<AuthState>((set) => ({
  session: local.get<AuthSession>(AUTH_STORAGE_KEY),
  setFromResponse: (response) => {
    const session = toSession(response)
    local.set(AUTH_STORAGE_KEY, session)
    set({ session })
  },
  adopt: (session) => set({ session }),
  clear: () => {
    local.remove(AUTH_STORAGE_KEY)
    set({ session: null })
  },
}))

// Keep every open tab on the same credentials: another tab may have rotated the refresh token.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_STORAGE_KEY) {
      useAuth.setState({ session: local.get<AuthSession>(AUTH_STORAGE_KEY) })
    }
  })
}
