import { local } from '../lib/storage'
import { AUTH_STORAGE_KEY, type AuthSession, useAuth } from '../state/auth'
import type { AuthResponse, ProblemDetails } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails

  constructor(status: number, problem: ProblemDetails) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`)
    this.status = status
    this.problem = problem
  }

  get code(): string | undefined {
    return this.problem.code
  }
}

export class OfflineError extends Error {
  constructor() {
    super('The server could not be reached.')
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  auth?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

const REFRESH_MARGIN_MS = 30_000
let refreshInFlight: Promise<boolean> | null = null

/**
 * Single-flight refresh. Rotating the same refresh token twice trips the server's reuse detection and revokes the
 * whole session, so refreshes are serialised within the tab (shared promise) and across tabs (Web Locks).
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= withRefreshLock(doRefresh).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

function withRefreshLock(fn: () => Promise<boolean>): Promise<boolean> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('sf-auth-refresh', fn)
    : fn()
}

async function doRefresh(): Promise<boolean> {
  const session = useAuth.getState().session
  if (!session) {
    return false
  }

  // Another tab may have rotated while we waited for the lock; adopt its fresh credentials instead.
  const stored = local.get<AuthSession>(AUTH_STORAGE_KEY)
  if (stored && stored.refreshToken !== session.refreshToken && stored.accessTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS) {
    useAuth.getState().adopt(stored)
    return true
  }

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        useAuth.getState().clear()
      }
      return false
    }
    useAuth.getState().setFromResponse((await response.json()) as AuthResponse)
    return true
  } catch {
    return false
  }
}

async function accessToken(): Promise<string | null> {
  const session = useAuth.getState().session
  if (!session) {
    return null
  }
  if (session.accessTokenExpiresAt - Date.now() < REFRESH_MARGIN_MS) {
    await refreshSession()
  }
  return useAuth.getState().session?.accessToken ?? null
}

export async function rawRequest(path: string, options: RequestOptions = {}, retry = true): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.auth !== false) {
    const token = await accessToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error
    }
    throw new OfflineError()
  }

  if (response.status === 401 && retry && options.auth !== false && useAuth.getState().session) {
    if (await refreshSession()) {
      return rawRequest(path, options, false)
    }
  }

  return response
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawRequest(path, options)
  if (!response.ok) {
    let problem: ProblemDetails = { status: response.status }
    try {
      problem = { ...problem, ...((await response.json()) as ProblemDetails) }
    } catch {
      // Non-JSON error body.
    }
    throw new ApiError(response.status, problem)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}
