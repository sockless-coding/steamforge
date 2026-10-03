import { create } from 'zustand'
import { local } from '../lib/storage'

export type QualityTier = 'auto' | 'low' | 'medium' | 'high' | 'ultra'

export interface Settings {
  quality: QualityTier
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  ambienceVolume: number
  /** Pan the camera when the mouse touches the window edge. */
  edgeScroll: boolean
  /** Show the controls cheat sheet in game. */
  showHints: boolean
  /** Run the gaslit day/night cycle (purely visual). */
  dayNight: boolean
}

export const defaultSettings: Settings = {
  quality: 'auto',
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  ambienceVolume: 0.5,
  edgeScroll: false,
  showHints: true,
  dayNight: true,
}

const KEY = 'sf.settings'

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  /** Merge settings synced from the server profile (preferences only; never progression). */
  hydrate: (remote: Record<string, unknown>) => void
}

function sanitize(raw: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const value = raw[key]
    if (typeof value === typeof defaultSettings[key]) {
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

export const useSettings = create<SettingsState>((set) => ({
  settings: { ...defaultSettings, ...sanitize(local.get<Record<string, unknown>>(KEY) ?? {}) },
  update: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch }
      local.set(KEY, settings)
      return { settings }
    }),
  hydrate: (remote) =>
    set((state) => {
      const settings = { ...state.settings, ...sanitize(remote) }
      local.set(KEY, settings)
      return { settings }
    }),
}))
