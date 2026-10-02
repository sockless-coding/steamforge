import { type FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { login, register, upgradeGuest } from '../api/account'
import { ApiError } from '../api/http'
import { useAuth } from '../state/auth'
import { Button, GearBackdrop, Panel, ScreenHeader, Tabs } from '../ui/components'
import './screens.css'

type Mode = 'login' | 'register' | 'upgrade'

export function AuthScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const isGuest = session?.kind === 'guest'
  const initial = (params.get('mode') as Mode | null) ?? (isGuest ? 'upgrade' : 'login')
  const [mode, setMode] = useState<Mode>(initial === 'upgrade' && !isGuest ? 'register' : initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else if (mode === 'register') await register(email, password, displayName)
      else await upgradeGuest(email, password, displayName || undefined)
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError && err.problem.errors) {
        setError(Object.values(err.problem.errors).flat().join(' '))
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const tabs: { id: Mode; label: string }[] = isGuest
    ? [
        { id: 'upgrade', label: 'Secure this profile' },
        { id: 'login', label: 'Sign in' },
      ]
    : [
        { id: 'login', label: 'Sign in' },
        { id: 'register', label: 'Register' },
      ]

  return (
    <div className="screen">
      <GearBackdrop />
      <ScreenHeader title="Guild Registry" />
      <div className="auth-wrap">
        <Panel>
          <Tabs tabs={tabs} value={mode} onChange={setMode} />
          <form onSubmit={submit} className="auth-form">
            {mode === 'upgrade' && (
              <p className="muted">
                Register an email and password to keep your cloud saves and colony records safe and play them on any device.
              </p>
            )}
            {mode === 'login' && isGuest && (
              <p className="muted">Signing in to another account leaves this guest profile behind on this device.</p>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? 1 : 10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {mode !== 'login' && (
              <div className="field">
                <label htmlFor="name">Founder name{mode === 'upgrade' ? ' (optional)' : ''}</label>
                <input
                  id="name"
                  required={mode === 'register'}
                  minLength={3}
                  maxLength={24}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <Button type="submit" disabled={busy} icon={mode === 'login' ? 'user' : 'shield'}>
              {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Secure profile'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
