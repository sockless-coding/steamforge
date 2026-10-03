import { create } from 'zustand'
import type { ResourceCategory } from '../api/types'
import type { Notice, TradeOrder } from '../game/sim/types'

export type Tool =
  | { kind: 'select' }
  | { kind: 'build'; def: string }
  | { kind: 'road'; road: string }
  | { kind: 'removeRoad' }
  /** Lays conduit of a grade (the network's basic conduit when absent). */
  | { kind: 'conduit'; network: string; grade?: string }
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
  /** The citizen's guild, and whether it is on strike. */
  guild: { name: string; color: string; striking: boolean } | null
}

/** A guild's standing for the badges and the Guild panel. */
export interface GuildRow {
  id: string
  name: string
  short: string
  color: string
  description: string
  standing: number
  /** Where standing is heading, and what makes it up. */
  target: number
  parts: [string, number][]
  mood: 'proud' | 'content' | 'grumbling' | 'workToRule' | 'striking'
  members: number
  automatonsInTrade: number
  mechanise: boolean
  /** Automatons please (positive) or anger (negative) this guild. */
  automatonWeight: number
  hall: boolean
}

/** One forge on the Hollowmere chart, as the colony knows it. */
export interface ForgeRow {
  id: string
  number: number
  name: string
  /** Chart position (-1..1, the colony at the centre), distance and months each way. */
  x: number
  y: number
  leagues: number
  months: number
  status: 'answering' | 'silent' | 'visited'
  /** The fate, once known. */
  fate: string | null
  fateText: string | null
  persona: string | null
  /** Answering forges: goodwill 0-100 and the open request. */
  relation: number | null
  request: { text: string; wants: { name: string; qty: number; have: number }[]; gives: string; monthsLeft: number } | null
  /** Why an expedition (of the smallest crew) cannot leave for it now; null when it can. */
  launchBlocked: string | null
  /** An expedition bound for it: outbound or returning, and how far along (0-1). */
  expedition: { stage: 'outbound' | 'returning'; progress: number; crew: number; monthsLeft: number } | null
  /** Relics or plans still waiting there (known only by rumour until visited). */
  rumour: string | null
}

export interface SagaInfo {
  act: number
  chartName: string
  /** The league distance the chart's outer ring stands for. */
  maxLeagues: number
  forges: ForgeRow[]
  yard: boolean
  telegraph: boolean
  crew: [number, number]
  launchCost: string
  relics: { name: string; description: string }[]
  papers: number
  /** Act III: the creeping core and the two answers to it. */
  finale: {
    state: 'pending' | 'retrofitting' | 'retrofitted' | 'decommissioned' | 'ruptured'
    creep: number
    retrofitBlocked: string | null
    ventBlocked: string | null
    monthsLeft: number
  } | null
}

/** A guild petition waiting for an answer. */
export interface GuildPetitionInfo {
  guild: string
  short: string
  color: string
  title: string
  text: string
  choices: string[]
  /** Share of the guild's patience left (1 when raised, 0 when unanswered counts as refused). */
  patience: number
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

/** `salvage`: plans only an expedition can find. */
export type ResearchStatus = 'done' | 'current' | 'queued' | 'available' | 'locked' | 'salvage'

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
  air: AirInfo
  guilds: GuildRow[]
  guildPetition: GuildPetitionInfo | null
  /** No automaton will be built for this many more months (a pledge to the guilds). */
  automatonPledge: number
  saga: SagaInfo | null
}

/** Coal smoke over the colony, for the barometer and wind vane. */
export interface AirInfo {
  /** Mean soot exposure (0-1) at the colony's homes, and the worst home. */
  homes: number
  worst: number
  /** Exposure past which lungs suffer. */
  safe: number
  /** Compass degrees the wind blows from, and its speed in tiles per second. */
  windFrom: number
  windSpeed: number
  /** The soot heat map is shown over the ground. */
  view: boolean
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
  air: { homes: 0, worst: 0, safe: 0.25, windFrom: 0, windSpeed: 0, view: false },
  guilds: [],
  guildPetition: null,
  automatonPledge: 0,
  saga: null,
}

/** Snapshot of the running colony for React. The GameController publishes into it; components only read. */
export const useHud = create<HudState>(() => initialHud)
