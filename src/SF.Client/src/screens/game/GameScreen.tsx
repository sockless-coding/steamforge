import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useLoadedContent } from '../../api/content'
import { GameController } from '../../game/GameController'
import { usePendingGame } from '../../state/pending'
import { useSettings } from '../../state/settings'
import { Hud } from './Hud'
import './game.css'

export function GameScreen() {
  const content = useLoadedContent()
  const start = usePendingGame((s) => s.start)
  const settings = useSettings((s) => s.settings)
  const host = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<GameController | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!start || !host.current) return
    const c = new GameController({
      parent: host.current,
      content,
      settings: useSettings.getState().settings,
      start,
      onMenu: () => setMenu((open) => !open),
    })
    setController(c)
    if (import.meta.env.DEV) (window as unknown as { steamforge: GameController }).steamforge = c
    return () => {
      c.destroy()
      setController(null)
    }
  }, [start, content])

  useEffect(() => {
    controller?.setQualitySettings(settings)
  }, [controller, settings])

  if (!start) return <Navigate to="/" replace />

  return (
    <div className="game-screen">
      <div className="game-host" ref={host} />
      {controller && <Hud controller={controller} menu={menu} setMenu={setMenu} />}
    </div>
  )
}
