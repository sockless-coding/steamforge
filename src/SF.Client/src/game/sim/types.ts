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
  /** Waits until sunrise. */
  | { op: 'sleep' }
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
  /** The player chose this citizen's job: the overseer neither moves them nor lets them go to fill other places. */
  pinned?: boolean
  /** Work put down at nightfall, resumed when the same job is taken up again. */
  shelved?: { effect: string; args: number[]; t: number }
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
  /** Conduit grade id; the network's basic conduit when absent. */
  grade?: string
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
  level: 'info' | 'good' | 'warn' | 'bad' | 'story' | 'petition'
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
  /** Citizens who left the colony (guild emigration). */
  departures?: number
}

/** A guild's standing and policy. */
export interface GuildState {
  /** 0-100; drifts each month towards a target built from its members' conditions. */
  standing: number
  striking: boolean
  /** Automatons may work this guild's trades. */
  mechanise: boolean
  /** Lingering petition effects: a mood adds to the standing target, work multiplies members' work speed. */
  effects: { kind: 'mood' | 'work'; value: number; until: number }[]
}

/** An answering forge's standing with the colony, or what the colony knows of a silent one. */
export interface ForgeState {
  /** Current fate (forges.json fate id): an answering forge that is failed falls silent with its failFate. */
  fate: string
  /** An expedition has reached it. */
  visited: boolean
  /** The colony knows its fate. */
  revealed: boolean
  /** Answering forges: goodwill (0 = it falls silent), the open request, and when the next one comes. */
  relation?: number
  request?: { id: string; expires: number } | null
  nextRequest?: number
  cursor?: number
  /** The first telegram has arrived. */
  greeted?: boolean
}

/** An airship crew away on the Hollowmere chart. Its crew are kept here, off the map, until they come home. */
export interface Expedition {
  id: number
  forge: string
  crew: Citizen[]
  departed: number
  /** Month indices of arrival at the forge and of the return home. */
  arrives: number
  returns: number
  stage: 'outbound' | 'returning'
  /** Found at the forge, handed over on the return: salvage, survivors, and finds ('relic:id', 'blueprint:id', 'papers:id', 'lost:name'). */
  loot: Stock
  survivors: number
  finds: string[]
  /** The airship went down with all hands (learned when it fails to return). */
  lost: boolean
}

export type FinaleState = 'none' | 'pending' | 'retrofitting' | 'retrofitted' | 'decommissioned' | 'ruptured'

/** The three-act story beyond the charter: the silent forges, their papers and relics, and the creeping core. */
export interface SagaState {
  act: number
  relics: string[]
  forges: Record<string, ForgeState>
  expeditions: Expedition[]
  nextExpedition: number
  /** Act III: the Steamforge's core pressure (rupture at 1), and how many warnings have been given. */
  creep: number
  warned: number
  finale: FinaleState
  /** Month index the retrofit completes. */
  finaleUntil: number
}

/** A guild petition waiting for the player's answer. */
export interface GuildPetition {
  /** petitions.json id. */
  id: string
  arrived: number
  expires: number
}

/** Every player command. All are accepted while paused; none take effect until time runs. */
/** Travellers asking to join. They wait at the headquarters until the player answers or they give up. */
export interface Petition {
  /** One entry per household: the number of children travelling with a couple, or -1 for a lone adult. */
  households: number[]
  adults: number
  children: number
  /** Some of them carry fever, and would bring it into the colony. */
  feverish: boolean
  /** Event that sent them (events.json id), for its parameters. */
  event: string
  /** Tick they arrived at, and the tick at which they give up and move on. */
  arrived: number
  expires: number
}

export type Action =
  | { type: 'place'; def: string; x: number; y: number; rot: Rotation; w?: number; h?: number }
  | { type: 'road'; road: string; tiles: number[] }
  | { type: 'removeRoad'; tiles: number[] }
  /** Lays conduit of a grade (the network's basic one by default); laying a different grade over a conduit upgrades it. */
  | { type: 'conduit'; network: string; tiles: number[]; grade?: string }
  | { type: 'removeConduit'; network: string; tiles: number[] }
  | { type: 'research'; tech: string }
  | { type: 'clearResearch' }
  | { type: 'setTrade'; res: string; mode: 'export' | 'import' | 'none'; amount: number }
  | { type: 'markClear'; tiles: number[]; clear: boolean }
  /** Grows or shrinks a variable-size building (a field) to a new footprint overlapping its old one. */
  | { type: 'resize'; building: number; x: number; y: number; w: number; h: number }
  | { type: 'demolish'; building: number }
  | { type: 'cancelSite'; building: number }
  | { type: 'prioritise'; building: number; priority: boolean }
  | { type: 'setWorkers'; building: number; count: number }
  | { type: 'setBuilders'; count: number }
  /**
   * Puts a citizen to a job of the player's choosing (a workplace by id, building or labour) and keeps them there, or
   * with 'auto' hands them back to the overseer.
   */
  | { type: 'assignCitizen'; citizen: number; job: number | 'laborer' | 'builder' | 'auto' }
  | { type: 'setLimit'; res: string; limit: number }
  | { type: 'setOption'; building: number; key: string; value: string }
  | { type: 'answerPetition'; accept: boolean }
  | { type: 'answerGuildPetition'; choice: number }
  /** Allows or forbids automatons in a guild's trades (those already working them are let go). */
  | { type: 'setGuildPolicy'; guild: string; mechanise: boolean }
  /** Sends an expedition airship from the yard to a silent forge. */
  | { type: 'launchExpedition'; forge: string; crew: number }
  /** Sends an answering forge the goods it asked for by telegraph. */
  | { type: 'fulfilRequest'; forge: string }
  /** Act III: retrofit the creeping Steamforge, or vent and seal it. */
  | { type: 'finale'; choice: 'retrofit' | 'vent' }

export type ActionResult = { ok: true; building?: number } | { ok: false; reason: string }

export type SimEvent =
  | { type: 'notice'; notice: Notice }
  | { type: 'building'; id: number; change: 'added' | 'completed' | 'removed' | 'changed' }
  | { type: 'feature'; tile: number }
  | { type: 'road'; tile: number }
  | { type: 'conduit'; tile: number }
  | { type: 'research'; tech: string }
  | { type: 'terrain'; x: number; y: number; w: number; h: number }
  | { type: 'citizen'; id: number; change: 'born' | 'arrived' | 'died' | 'built' | 'left'; cause?: string }
  | { type: 'expedition'; id: number; forge: string; change: 'departed' | 'returned' }
  | { type: 'month'; month: number; year: number }
  | { type: 'fire'; building: number; active: boolean }
  | { type: 'outcome'; outcome: 'lost' }
