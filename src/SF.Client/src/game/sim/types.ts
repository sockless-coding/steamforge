// Simulation state, commands and events. Everything here is plain data so a colony serializes to JSON as-is.

import type { Stock } from '../../api/types'

export type { Stock }

export type Rotation = 0 | 1 | 2 | 3

/** Terrain codes stored in World.terrain. Content refers to them by name (see TERRAIN_IDS). */
export const Terrain = {
  Grass: 0,
  Water: 1,
  Mountain: 2,
  Stone: 3,
  Iron: 4,
  Coal: 5,
  Sand: 6,
  Copper: 7,
} as const

export const TERRAIN_IDS: Record<string, number> = {
  grass: Terrain.Grass,
  water: Terrain.Water,
  mountain: Terrain.Mountain,
  stone: Terrain.Stone,
  iron: Terrain.Iron,
  coal: Terrain.Coal,
  sand: Terrain.Sand,
  copper: Terrain.Copper,
}

export interface NewColonyOptions {
  seed: number
  name: string
  difficulty: string
  mapSize: string
  terrain: string
}

export interface SiteState {
  stage: 'clearing' | 'building'
  delivered: Stock
  incoming: Stock
  /** Accumulated worker-seconds. */
  work: number
  priority: boolean
}

export interface Building {
  id: number
  def: string
  x: number
  y: number
  w: number
  h: number
  rot: Rotation
  /** Entrance tile index; citizens path here to use the building. */
  door: number
  baseHeight: number
  site: SiteState | null
  /** Storage contents, a workplace's inputs/outputs, or a home's pantry. */
  stock: Stock
  /** Stock promised to pending pickups. */
  reserved: Stock
  /** Deliveries in flight (counts against storage capacity / input needs). */
  incoming: Stock
  workers: number[]
  /** Player-chosen worker target (≤ the definition's maximum). */
  workerTarget: number
  residents: number[]
  /** Component state. Keys are owned by the component handlers. */
  data: Record<string, number | string | boolean | number[]>
  /** Seconds of fire remaining; 0 when not burning. */
  fire: number
  /** Last simulation second a worker was busy here (drives smoke, glow and gears). */
  activeAt: number
}

export type Step =
  | { op: 'goto'; tile: number; enter?: number }
  | { op: 'work'; seconds: number; effect: string; args?: number[]; at?: number }
  | { op: 'wait'; seconds: number }
  | { op: 'take'; from: number; res: string; qty: number }
  | { op: 'give'; to: number }
  | { op: 'do'; effect: string; args?: number[] }

export type Reservation =
  | { kind: 'stock'; b: number; res: string; qty: number }
  | { kind: 'incoming'; b: number; res: string; qty: number }
  | { kind: 'site'; b: number; res: string; qty: number }
  | { kind: 'tile'; tile: number }
  | { kind: 'slot'; b: number; key: string }

export type TaskKind = 'need' | 'work' | 'labor' | 'build' | 'idle'

export interface Task {
  kind: TaskKind
  label: string
  steps: Step[]
  i: number
  /** Progress within the current step (seconds for work steps). */
  t: number
  res: Reservation[]
  /** Building the task serves (workplace, site, home), for display. */
  about: number
}

export interface Citizen {
  id: number
  name: string
  female: boolean
  /** Age in months. */
  age: number
  partner: number
  mother: number
  father: number
  home: number
  workplace: number
  /** 'child', 'laborer', 'builder' or the workplace's profession. */
  profession: string
  x: number
  y: number
  /** Position at the start of the tick, for render interpolation. */
  px: number
  py: number
  path: number[] | null
  pathI: number
  /** Building the citizen is inside (hidden), 0 when outdoors. */
  inside: number
  task: Task | null
  carry: Stock | null
  hunger: number
  warmth: number
  health: number
  happiness: number
  /** Months of tool life remaining. */
  tools: number
  /** Months of coat life remaining. */
  coat: number
  /** Months of sickness remaining. */
  sick: number
  /** Health lost per month while sick. */
  sickRate: number
  /** Recently eaten food resource ids (most recent last). */
  diet: string[]
  /** Ticks to wait before choosing a new task (back-off after failure). */
  wait: number
  /** A clockwork automaton: works but never eats, freezes, marries or ages normally. */
  automaton?: boolean
  /** Automatons: months of winding left; at 0 it has run down. */
  wind?: number
}

export interface RoadJob {
  tile: number
  road: string
  delivered: boolean
}

/** A conduit tile (steam pipe, copper conduit) ordered but not yet laid. */
export interface ConduitJob {
  tile: number
  network: string
}

export interface TradeOrder {
  mode: 'export' | 'import'
  /** Export everything above this many in storage, or import until storage holds this many. */
  amount: number
}

export interface ResearchState {
  done: string[]
  /** Planned research, current first. */
  queue: string[]
  /** Points put into unfinished research (kept when the queue changes). */
  progress: Record<string, number>
}

export interface Notice {
  id: number
  tick: number
  level: 'info' | 'good' | 'warn' | 'bad' | 'story'
  text: string
  /** Story dispatch id for 'story' notices. */
  dispatch?: string
  /** Tile to focus when clicked. */
  at?: number
}

export interface ColonyStats {
  births: number
  deaths: number
  arrivals: number
  peakPopulation: number
  deathsBy: Record<string, number>
  /** Lifetime totals, for the overview and balancing. */
  produced: Stock
  consumed: Stock
}

/** Every player command. All are accepted while paused; none take effect until time runs. */
export type Action =
  | { type: 'place'; def: string; x: number; y: number; rot: Rotation; w?: number; h?: number }
  | { type: 'road'; road: string; tiles: number[] }
  | { type: 'removeRoad'; tiles: number[] }
  | { type: 'conduit'; network: string; tiles: number[] }
  | { type: 'removeConduit'; network: string; tiles: number[] }
  | { type: 'research'; tech: string }
  | { type: 'clearResearch' }
  | { type: 'setTrade'; res: string; mode: 'export' | 'import' | 'none'; amount: number }
  | { type: 'markClear'; tiles: number[]; clear: boolean }
  | { type: 'demolish'; building: number }
  | { type: 'cancelSite'; building: number }
  | { type: 'prioritise'; building: number; priority: boolean }
  | { type: 'setWorkers'; building: number; count: number }
  | { type: 'setBuilders'; count: number }
  | { type: 'setLimit'; res: string; limit: number }
  | { type: 'setOption'; building: number; key: string; value: string }

export type ActionResult = { ok: true; building?: number } | { ok: false; reason: string }

export type SimEvent =
  | { type: 'notice'; notice: Notice }
  | { type: 'building'; id: number; change: 'added' | 'completed' | 'removed' | 'changed' }
  | { type: 'feature'; tile: number }
  | { type: 'road'; tile: number }
  | { type: 'conduit'; tile: number }
  | { type: 'research'; tech: string }
  | { type: 'terrain'; x: number; y: number; w: number; h: number }
  | { type: 'citizen'; id: number; change: 'born' | 'arrived' | 'died' | 'built'; cause?: string }
  | { type: 'month'; month: number; year: number }
  | { type: 'fire'; building: number; active: boolean }
  | { type: 'outcome'; outcome: 'lost' }
