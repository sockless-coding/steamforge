import { create } from 'zustand'
import type { GameStart } from '../game/GameController'

/** The colony the game screen should open next (a new founding or a decoded save). Snapshots are too big for history state. */
export const usePendingGame = create<{ start: GameStart | null; set: (start: GameStart | null) => void }>((set) => ({
  start: null,
  set: (start) => set({ start }),
}))
