import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useProfile } from '../api/account'
import { useContent } from '../api/content'
import { MusicDirector } from '../game/audio/music'
import { play } from '../game/audio/synth'
import { AuthScreen } from '../screens/AuthScreen'
import { GameScreen } from '../screens/game/GameScreen'
import { Sandbox } from '../screens/game/Sandbox'
import { LoadScreen } from '../screens/LoadScreen'
import { NewGameScreen } from '../screens/NewGameScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { TitleScreen } from '../screens/TitleScreen'
import { useSettings } from '../state/settings'
import { Button, GearBackdrop, GearSpinner } from '../ui/components'
import { UpdatePrompt } from './UpdatePrompt'

export function App() {
  const content = useContent()
  const profile = useProfile()
  const hydrate = useSettings((s) => s.hydrate)

  // Menus get the calm workshop theme; the colony drives its own soundscape.
  const location = useLocation()
  const inGame = location.pathname.startsWith('/play') || location.pathname.startsWith('/dev/')
  useEffect(() => {
    const start = () => {
      if (!inGame) MusicDirector.get().setMode('menu')
    }
    start()
    window.addEventListener('pointerdown', start, { once: true })
    return () => window.removeEventListener('pointerdown', start)
  }, [inGame])

  // Mechanical click on every control.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('.btn, .tab, .build-card, .speed-btn, .difficulty-preset, .tool-btn')
      if (el && !(el as HTMLButtonElement).disabled) play('click', { bus: 'ui', volume: 0.7, cooldown: 0.02 })
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  // Pull synced preferences once the profile arrives.
  useEffect(() => {
    if (profile.data?.settings) hydrate(profile.data.settings)
  }, [profile.data?.accountId, hydrate]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!content.data) {
    return (
      <div className="screen center">
        <GearBackdrop />
        {content.error ? (
          <div style={{ zIndex: 1, textAlign: 'center' }}>
            <p className="error-text">The foundry could not be reached. {(content.error as Error).message}</p>
            <Button onClick={() => content.refetch()} icon="gear">
              Retry
            </Button>
          </div>
        ) : (
          <GearSpinner label="Stoking the boilers…" />
        )}
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<TitleScreen />} />
        <Route path="/new" element={<NewGameScreen />} />
        <Route path="/load" element={<LoadScreen />} />
        <Route path="/play" element={<GameScreen />} />
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        {import.meta.env.DEV && <Route path="/dev/sandbox" element={<Sandbox />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdatePrompt />
    </>
  )
}
