import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePendingGame } from '../../state/pending'
import { GameScreen } from './GameScreen'

/**
 * Dev-only quick start for visual review: /dev/sandbox?difficulty=engineer&seed=42&size=small&terrain=valley
 */
export function Sandbox() {
  const [params] = useSearchParams()
  const start = usePendingGame((s) => s.start)
  const set = usePendingGame((s) => s.set)

  useEffect(() => {
    set({
      mode: 'new',
      options: {
        seed: Number(params.get('seed') ?? 42) >>> 0,
        name: params.get('name') ?? 'Sandbox',
        difficulty: params.get('difficulty') ?? 'tinkerer',
        mapSize: params.get('size') ?? 'small',
        terrain: params.get('terrain') ?? 'valley',
      },
    })
  }, [params, set])

  return start ? <GameScreen /> : null
}
