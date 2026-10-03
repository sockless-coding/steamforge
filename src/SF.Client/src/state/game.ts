import { create } from 'zustand'
import type { ResourceCategory } from '../api/types'
import type { Notice, TradeOrder } from '../game/sim/types'

export type Tool =
  | { kind: 'select' }
  | { kind: 'build'; def: string }
  | { kind: 'road'; road: string }
  | { kind: 'removeRoad' }
  | { kind: 'conduit'; network: string }
  | { kind: 'removeConduit'; network: string }
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
  /** Company credit per unit; 0 when the Company won't trade it. */
  value: number
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
  /** Clockwork automatons: months of winding left out of a full winding. */
  automaton: { wind: number; windMonths: number } | null
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

export type ResearchStatus = 'done' | 'current' | 'queued' | 'available' | 'locked'

export interface ResearchRow {
  id: string
  name: string
  description: string
  tier: number
  points: number
  progress: number
  requires: string[]
  unlocks: string[]
  status: ResearchStatus
}

export interface NetworkRow {
  id: string
  name: string
  unit: string
  color: string
  supply: number
  demand: number
  /** Any generator or consumer of this network has been built. */
  active: boolean
}

export interface PetitionInfo {
  adults: number
  children: number
  /** Households: couples (with their children) and lone adults. */
  families: number
  feverish: boolean
  /** Share of their patience left (1 on arrival, 0 when they move on). */
  patience: number
}

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
  /** Clock time, "HH:MM". */
  timeOfDay: string
  /** Between sunset and sunrise: only lamplit work goes on. */
  night: boolean
  /** Travellers waiting at the gate for an answer. */
  petition: PetitionInfo | null
  temperature: number
  population: { total: number; adults: number; children: number; elders: number; homeless: number; automatons: number }
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
  research: ResearchRow[]
  /** Points per research project on the drafting tables, null when nothing is queued. */
  researching: { name: string; progress: number; points: number } | null
  networks: NetworkRow[]
  /** Story dispatches received, oldest first. */
  dispatches: string[]
  /** Content still locked behind research: "building:<id>", "road:<id>", "network:<id>" -> research name. */
  locks: Record<string, string>
  /** Company credit from airship trade. */
  credit: number
  trade: Record<string, TradeOrder>
  /** A finished airship mast stands, so trade orders take effect. */
  hasMast: boolean
}

export const initialHud: HudState = {
  ready: false,
  colonyName: '',
  difficulty: '',
  paused: false,
  speed: 0,
  speeds: [1, 2, 5, 10, 20],
  year: 1,
  month: 0,
  monthName: '',
  season: 'spring',
  monthProgress: 0,
  timeOfDay: '12:00',
  night: false,
  petition: null,
  temperature: 0,
  population: { total: 0, adults: 0, children: 0, elders: 0, homeless: 0, automatons: 0 },
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
  research: [],
  researching: null,
  networks: [],
  dispatches: [],
  locks: {},
  credit: 0,
  trade: {},
  hasMast: false,
}

/** Snapshot of the running colony for React. The GameController publishes into it; components only read. */
export const useHud = create<HudState>(() => initialHud)
