import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logout, useProfile } from '../api/account'
import { useLoadedContent } from '../api/content'
import { decodeSnapshot, listLocalSaves, readLocalSave } from '../lib/saves'
import { useAuth } from '../state/auth'
import { usePendingGame } from '../state/pending'
import { Button, GearBackdrop } from '../ui/components'
import { Icon } from '../ui/Icon'
import './screens.css'

export function TitleScreen() {
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const profile = useProfile()
  const content = useLoadedContent()
  const setPending = usePendingGame((s) => s.set)
  const local = useQuery({ queryKey: ['local-saves'], queryFn: listLocalSaves })
  const latest = local.data?.[0]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resume = async () => {
    if (!latest) return
    setBusy(true)
    setError(null)
    try {
      const data = await readLocalSave(latest.id)
      if (!data) throw new Error('The save could not be read.')
      setPending({ mode: 'load', snapshot: await decodeSnapshot(data) })
      navigate('/play')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="screen title-screen">
      <GearBackdrop />
      <div className="title-logo">
        <div className="title-spark" aria-hidden="true" />
        <h1 className="title-name engraved">SteamForge</h1>
        <div className="title-sub">
          <span />
          <h2>A Colony of Brass &amp; Steam</h2>
          <span />
        </div>
      </div>

      <nav className="title-menu">
        {latest && (
          <>
            <Button size="lg" variant="copper" icon="forward" disabled={busy} onClick={() => void resume()}>
              Continue {latest.name}
            </Button>
            <span className="continue-card">{latest.summary}</span>
          </>
        )}
        <Button size="lg" icon="play" onClick={() => navigate('/new')}>
          Found a Colony
        </Button>
        <div className="title-grid">
          <Button variant="iron" icon="folder" onClick={() => navigate('/load')}>
            Load
          </Button>
          <Button variant="iron" icon="gear" onClick={() => navigate('/settings')}>
            Settings
          </Button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </nav>

      <footer className="title-footer">
        <div className="account-badge">
          <Icon name="user" size={18} />
          {session ? (
            <>
              <span>{profile.data?.displayName ?? session.displayName}</span>
              {session.kind === 'guest' ? (
                <Button size="sm" variant="copper" onClick={() => navigate('/auth?mode=upgrade')}>
                  Secure cloud saves
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void logout()}>
                  Sign out
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="iron" onClick={() => navigate('/auth?mode=login')}>
              Sign in for cloud saves
            </Button>
          )}
        </div>
        <div className="title-footer-end">
          <span className="muted version">Content {content.bundle.version}</span>
        </div>
      </footer>
    </div>
  )
}
