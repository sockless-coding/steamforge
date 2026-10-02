import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../ui/components'

/** Offers to reload when a new build is installed by the service worker (never mid-battle without asking). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for updates hourly while the game stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null
  return (
    <div className="update-toast">
      <span>A new version of the foundry is ready.</span>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        Update
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
    </div>
  )
}
