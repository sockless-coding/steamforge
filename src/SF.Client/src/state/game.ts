import { create } from 'zustand'
import type { ResourceCategory } from '../api/types'
import type { Notice } from '../game/sim/types'

export type Tool =
  | { kind: 'select' }
  | { kind: 'build'; def: string }
  | { kind: 'road'; road: string }
  | { kind: 'removeRoad' }
  | { kind: 'clear' }
  | { kind: 'unclear' }
  | { kind: 'demolish' }

export interface ResourceRow {
  id: string
  name: string
  category: ResourceCategory
  color: string
  amount: number
  limit: number | null
}

export interface SiteInfo {
  stage: 'clearing' | 'building'
  progress: number
  materials: { id: string; name: string; have: number; need: number }[]
  priority: boolean
}

export interface OptionInfo {
  key: string
  label: string
  value: string
  values: { id: string; name: string }[]
}

export interface BuildingInfo {
  kind: 'building'
  id: number
  def: string
  name: string
  description: string
  site: SiteInfo | null
  workers: { id: number; name: string }[]
  workerTarget: number
  maxWorkers: number
  residents: { id: number; name: string; age: number }[]
  lines: string[]
  stock: { id: string; name: string; amount: number }[]
  options: OptionInfo[]
  canDemolish: boolean
  burning: boolean
}

export interface CitizenInfo {
  kind: 'citizen'
  id: number
  name: string
  age: number
  female: boolean
  profession: string
  home: string | null
  workplace: string | null
  task: string | null
  hunger: number
  warmth: number
  health: number
  happiness: number
  tools: number
  coat: number
  sick: boolean
  carrying: string | null
}

export interface ProfessionRow {
  id: string
  name: string
  color: string
  workers: number
  target: number
  max: number
  buildings: number[]
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface HudState {
  ready: boolean
  colonyName: string
  difficulty: string
  paused: boolean
  speed: number
  speeds: number[]
  year: number
  month: number
  monthName: string
  season: string
  monthProgress: number
  temperature: number
  population: { total: number; adults: number; children: number; elders: number; homeless: number }
  peakPopulation: number
  resources: ResourceRow[]
  food: number
  tool: Tool
  hint: string | null
  selection: BuildingInfo | CitizenInfo | null
  notices: Notice[]
  outcome: 'playing' | 'lost'
  builders: { target: number; count: number }
  laborers: number
  professions: ProfessionRow[]
  sites: number
  save: SaveStatus
}

export const initialHud: HudState = {
  ready: false,
  colonyName: '',
  difficulty: '',
  paused: false,
  speed: 0,
  speeds: [1, 2, 5, 10],
  year: 1,
  month: 0,
  monthName: '',
  season: 'spring',
  monthProgress: 0,
  temperature: 0,
  population: { total: 0, adults: 0, children: 0, elders: 0, homeless: 0 },
  peakPopulation: 0,
  resources: [],
  food: 0,
  tool: { kind: 'select' },
  hint: null,
  selection: null,
  notices: [],
  outcome: 'playing',
  builders: { target: 0, count: 0 },
  laborers: 0,
  professions: [],
  sites: 0,
  save: 'idle',
}

/** Snapshot of the running colony for React. The GameController publishes into it; components only read. */
export const useHud = create<HudState>(() => initialHud)
