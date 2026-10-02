import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../state/auth'
import { api } from './http'
import type { AuthResponse, Profile } from './types'

function deviceId(): string {
  try {
    let id = localStorage.getItem('sf.device')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('sf.device', id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

export async function playAsGuest(displayName?: string): Promise<AuthResponse> {
  const response = await api<AuthResponse>('/api/auth/guest', {
    method: 'POST',
    auth: false,
    body: { deviceId: deviceId(), displayName: displayName || null },
  })
  useAuth.getState().setFromResponse(response)
  return response
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await api<AuthResponse>('/api/auth/login', { method: 'POST', auth: false, body: { email, password } })
  useAuth.getState().setFromResponse(response)
  return response
}

export async function register(email: string, password: string, displayName: string): Promise<AuthResponse> {
  const response = await api<AuthResponse>('/api/auth/register', {
    method: 'POST',
    auth: false,
    body: { email, password, displayName },
  })
  useAuth.getState().setFromResponse(response)
  return response
}

export async function upgradeGuest(email: string, password: string, displayName?: string): Promise<AuthResponse> {
  const response = await api<AuthResponse>('/api/auth/upgrade', {
    method: 'POST',
    body: { email, password, displayName: displayName || null },
  })
  useAuth.getState().setFromResponse(response)
  return response
}

export async function logout(): Promise<void> {
  const session = useAuth.getState().session
  if (session) {
    try {
      await api('/api/auth/logout', { method: 'POST', body: { refreshToken: session.refreshToken } })
    } catch {
      // Logging out locally is what matters; the server token expires regardless.
    }
  }
  useAuth.getState().clear()
}

export function useProfile() {
  const signedIn = useAuth((s) => s.session !== null)
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api<Profile>('/api/profile'),
    enabled: signedIn,
    staleTime: 30_000,
  })
}

export function useUpdateDisplayName() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: { displayName: string; expectedVersion: number }) =>
      api<Profile>('/api/profile', { method: 'PUT', body: args }),
    onSuccess: (profile) => client.setQueryData(['profile'], profile),
  })
}

export function saveSettings(settings: Record<string, unknown>): Promise<void> {
  return api('/api/profile/settings', { method: 'PUT', body: { settings } })
}
