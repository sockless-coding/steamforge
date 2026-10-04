// Mirrors of the server's content and API DTOs (camelCase JSON). Content documents are served verbatim from
// src/SF.Application/Content/*.json; keep these interfaces in sync with those files and with ContentModels.cs.

export type AccountKind = 'guest' | 'registered'
export type ResourceCategory = 'material' | 'fuel' | 'food' | 'goods'
export type Stock = Record<string, number>

export interface SeasonDef {
  id: string
  name: string
  months: number[]
  growing: boolean
}

export interface RoadDef {
  id: string
  name: string
  description: string
  cost: Stock
  work: number
  speed: number
  /** Only this fast while a powered depot (a building with a `tramDepot` component) runs; otherwise `unpoweredSpeed`. */
  needsDepot?: boolean
  unpoweredSpeed?: number
  /** Laid only over water, which it makes walkable. Builders work it outward from the bank. */
  bridge?: boolean
  /** Bridges only: the furthest a bridge tile may lie from dry land, in tiles (default 3). */
  maxFromShore?: number
}

export interface AutomatonRules {
  /** Months a full winding lasts. */
  windMonths: number
  /** Coal used to wind one automaton. */
  windCoal: string
  windAmount: number
  /** Years of service before an automaton is likely to seize up for good. */
  lifeYears: number
  workFactor: number
}

export interface TradeRules {
  /** Company credit per unit value when exporting. */
  sellFactor: number
  /** Company credit per unit value when importing. */
  buyFactor: number
}

export interface CitizenRules {
  walkSpeed: number
  carry: number
  adultAge: number
  partnerAge: number
  fertileAgeMax: number
  elderAge: number
  maxAge: number
  hungerPerMonth: number
  hungerThreshold: number
  mealSize: number
  childMealSize: number
  comfortTemperature: number
  coldPerMonth: number
  coatProtection: number
  warmthThreshold: number
  warmUpPerMonth: number
  healthRecoveryPerMonth: number
  starvationPerMonth: number
  freezingPerMonth: number
  toolLifeMonths: number
  coatLifeMonths: number
  noToolsWorkFactor: number
  elderWorkFactor: number
  birthChancePerMonth: number
  oldAgeDeathPerMonth: number
}

/** How a conduit grade is drawn. */
export type ConduitStyle = 'duct' | 'main' | 'lagged' | 'water' | 'wire'

/** One grade of conduit on a network (a brick duct, a riveted main, a lagged main...). */
export interface ConduitDef {
  /** Unique across every network's grades; research unlocks grades by this id. */
  id: string
  name: string
  description: string
  cost: Stock
  work: number
  /** Share of a generator's head lost per tile of this conduit (building footprints carry energy without loss). */
  lossPerTile: number
  style: ConduitStyle
}

/** An energy network: generators and consumers joined by conduit tiles (water mains, steam pipes, copper conduits). */
export interface NetworkDef {
  id: string
  name: string
  /** Short unit label for gauges, e.g. "psi" or "volts". */
  unit: string
  color: string
  /** The basic grade, laid from the start (or once the network is unlocked). */
  conduit: ConduitDef
  /** Better grades, usually unlocked by research. Laying one over an existing conduit upgrades it. */
  upgrades?: ConduitDef[]
}

export interface DayRules {
  daysPerMonth: number
  /** One fraction per month (0-1): the share of each day between sunrise and sunset. */
  daylight: number[]
  /** Work speed at night in lamplight (citizens who are not lit sleep instead). */
  nightWorkFactor: number
}

/** Prevailing winds: they carry soot across the map. Directions are compass degrees the wind blows from (0 = north). */
export interface WindRules {
  /** Prevailing direction per season id. */
  prevailing: Record<string, number>
  /** Each month the wind settles within this many degrees either side of the prevailing direction. */
  variance: number
  /** Range of wind speeds, in tiles per second. */
  speed: [number, number]
}

/** Coal smoke and its consequences. Soot is a coarse field (one cell per cellSize² tiles) moved by the wind. */
export interface SootRules {
  cellSize: number
  /** Share of each cell's soot exchanged with its neighbours per second. */
  diffusion: number
  /** Share of soot that disperses per second; forest cover adds forestDecayPerSecond, and winter air holds it longer. */
  decayPerSecond: number
  forestDecayPerSecond: number
  winterDecayFactor: number
  /** Share of soot that settles as lasting grime per second. */
  depositPerSecond: number
  /** Share of grime washed away each month. */
  grimeFadePerMonth: number
  /** Soot from each unit of firewood burned in a home stove. */
  stoveSootPerFirewood: number
  /** Soot per second from a burning building. */
  fireSootPerSecond: number
  /** Soot at which exposure counts as total (1). */
  fullSoot: number
  /** Grime at which the ground counts as fully fouled (1). */
  fullGrime: number
  /** Exposure below which lungs take no harm. */
  lungSafe: number
  /** Health lost per month at total exposure. */
  lungDamagePerMonth: number
  /** Children and elders lose health this many times faster. */
  vulnerableFactor: number
  /** Happiness lost at total exposure around the home. */
  happinessPenalty: number
  /** Crop yield lost on fully fouled ground. */
  cropPenalty: number
}

export interface RulesDef {
  ticksPerSecond: number
  secondsPerMonth: number
  months: string[]
  seasons: SeasonDef[]
  temperature: number[]
  temperatureJitter: number
  citizen: CitizenRules
  housing: { firewoodPerMonth: number; pantryMeals: number; pantryFirewood: number }
  workplace: { outputBuffer: number; inputBatches: number }
  construction: { workChunkSeconds: number; buildersPerTile: number; refundOnDemolish: number }
  /** Day and night: daylight is the lit fraction of each month's day; outside it citizens go home to sleep. */
  day: DayRules
  events: { disastersPerYear: number; blessingsPerYear: number; graceYears: number; minMonthsBetweenDisasters: number }
  roads: RoadDef[]
  networks: NetworkDef[]
  automaton: AutomatonRules
  trade: TradeRules
  wind: WindRules
  soot: SootRules
  guilds: GuildRules
  startingBuilders: number
  startingArea: number
}

export interface ResourceDef {
  id: string
  name: string
  category: ResourceCategory
  color: string
  spoilagePerYear: number
  /** Production stops once storage holds this many (0 = unlimited). Player-adjustable in game. */
  defaultLimit: number
  /** Company credit per unit; resources without a value cannot be traded by airship. */
  value?: number
}

export interface FeatureYield {
  resource: string
  amount: number
  seconds: number
}

export interface FeatureDef {
  id: string
  name: string
  /** Procedural nature model key understood by the renderer (tree, rock, ironstone, bush, mushroom). */
  model: string
  clear: FeatureYield
  harvest?: FeatureYield & { ripens: string[] }
  growth?: { months: number; spawnChance: number }
}

export type ModelShape = 'box' | 'cylinder' | 'cone' | 'sphere' | 'gable' | 'hip' | 'gear' | 'chimney' | 'stack' | 'tank' | 'pipe' | 'torus' | 'dome'

export interface ModelPart {
  shape: ModelShape
  mat: string
  /** Centre of the part's base, in tiles, relative to the footprint centre; +z is the front (door side). */
  pos: [number, number, number]
  size: [number, number, number]
  rot?: number
  axis?: 'x' | 'y' | 'z'
  /** Top radius as a fraction of the bottom radius (cylinders). */
  taper?: number
  /** Radians per second while the building is working (gears); also the stroke rate of bobbing parts. */
  spin?: number
  /** Brightens while the building is working (furnace mouths). */
  glow?: boolean
  /** Moves up and down by this many tiles while the building is working (pistons, steam hammers). */
  bob?: number
  /** Particles puffed from the top of the part while the building works (chimneys and stacks smoke by default). */
  emit?: 'smoke' | 'steam'
  /** Degrees of a partial torus (pipe bends); a full ring when omitted. */
  arc?: number
}

export interface ModelSpec {
  parts: ModelPart[]
  /** Draw stacked goods according to stored stock (stockyards). */
  piles?: boolean
}

export interface PlacementRules {
  terrain?: { id: string; min: number }
  adjacent?: { id: string; min: number }
  variableSize?: { min: [number, number]; max: [number, number] }
}

export type BuildingCategory = 'civic' | 'housing' | 'storage' | 'food' | 'resources' | 'industry' | 'power' | 'science'

export interface BuildingDef {
  id: string
  name: string
  category: BuildingCategory
  description: string
  size: [number, number]
  cost: { resources: Stock; work: number }
  limit?: number
  buildable?: boolean
  /** The colony's heart (the Steamforge): placed at founding, cannot be demolished. Exactly one per content set. */
  headquarters?: boolean
  walkable?: boolean
  placement?: PlacementRules
  /** Keyed by component kind; each kind is implemented by a handler in game/sim/components. */
  components: Record<string, unknown>
  model: ModelSpec
}

export interface RecipeDef {
  id: string
  name: string
  inputs: Stock
  outputs: Stock
  seconds: number
}

export interface CropDef {
  id: string
  name: string
  resource: string
  yieldPerTile: number
  growthMonths: number
  color: string
}

export interface ProfessionDef {
  id: string
  name: string
  color: string
  /** The guild this trade belongs to (guilds.json); laborers, builders and children belong to none. */
  guild?: string
}

/** A guild: the trades it speaks for, and how it feels about automatons. */
export interface GuildDef {
  id: string
  name: string
  short: string
  color: string
  description: string
  /**
   * Standing gained (negative: lost) at full mechanisation: `trade` counts automatons working the guild's own trades
   * (as a share of its workforce), `colony` counts automatons anywhere (as a share of all adult workers).
   */
  automatons: { weight: number; scope: 'trade' | 'colony' }
}

/** What answering a petition does. `guild` defaults to the petitioning guild. */
export type PetitionEffect =
  | { kind: 'standing'; guild?: string; amount: number }
  /** Adds to the guild's standing target for some months (a lingering grievance or goodwill). */
  | { kind: 'mood'; guild?: string; amount: number; months: number }
  /** Multiplies the work speed of the guild's members for some months. */
  | { kind: 'workFactor'; guild?: string; factor: number; months: number }
  /** Allows or forbids automatons in the guild's trades. */
  | { kind: 'mechanise'; guild?: string; value: boolean }
  /** No automaton is assembled for some months. */
  | { kind: 'noAutomatons'; months: number }
  /** Adds (or, negative, takes) a resource from storage; `food` takes a mix of foods. */
  | { kind: 'resource'; resource: string; amount: number }
  | { kind: 'credit'; amount: number }
  /** Adds to every citizen's happiness at once. */
  | { kind: 'happiness'; amount: number }

/** When a petition can be raised; every field that is set must hold. */
export interface PetitionCondition {
  season?: string
  minMembers?: number
  minStanding?: number
  maxStanding?: number
  /** A finished building of this kind stands. */
  building?: string
  /** At least this many automatons work the guild's trades. */
  automatonsInTrade?: number
  resource?: { id: string; min: number }
  credit?: number
  /** Food in storage. */
  food?: number
  /** Mean soot exposure of the guild's members. */
  sootAbove?: number
}

export interface PetitionDef {
  id: string
  guild: string
  title: string
  text: string
  weight: number
  when: PetitionCondition
  /** The last choice is taken if the petition goes unanswered. */
  choices: { label: string; effects: PetitionEffect[] }[]
}

/** Guild standing: a monthly drift towards a target built from members' conditions, and its thresholds. */
export interface GuildRules {
  /** Share of the gap between standing and its target closed each month. */
  drift: number
  base: number
  /** Target points per factor at full strength (fed, warm, health, happiness, soot, nightShift: shares or means 0-1; hall: 0/1). */
  weights: Record<'fed' | 'warm' | 'health' | 'happiness' | 'soot' | 'nightShift' | 'hall', number>
  /** At or above: members work faster by highWorkBonus. */
  high: number
  highWorkBonus: number
  /** Below: members work to rule at workToRuleFactor. */
  workToRule: number
  workToRuleFactor: number
  /** Below: the guild strikes, until it is 5 points above again. */
  strike: number
  /** At or below: monthly chances of sabotage and of a household emigrating. */
  unrest: number
  sabotageChance: number
  emigrationChance: number
  /** Months a petition waits for an answer before it counts as refused. */
  petitionWaitMonths: number
}

export interface GuildTemperament {
  startingStanding: number
  /** Multiplies how fast standing falls (not how fast it recovers). */
  standingDrift: number
  petitionsPerYear: number
}

export interface EventDef {
  id: string
  name: string
  /** Handler key in game/sim/events.ts. */
  kind: string
  disaster: boolean
  weight: number
  minYear: number
  seasons?: string[]
  params: Record<string, number | string>
}

export interface DifficultyModifiers {
  winterSeverity: number
  disasterRate: number
  productionMultiplier: number
  birthRate: number
  spoilageRate: number
  wearRate: number
  hungerRate: number
  /** Scales soot from every chimney and stove. */
  sootRate: number
}

export interface DifficultyPreset {
  id: string
  name: string
  description: string
  order: number
  startingFamilies: number
  startingResources: Stock
  startingBuildings: { id: string; count: number }[]
  /** Research already completed when the colony is founded. */
  startingResearch?: string[]
  modifiers: DifficultyModifiers
  guildTemperament?: GuildTemperament
}

export interface DifficultyCatalog {
  defaultPreset: string
  presets: DifficultyPreset[]
}

export interface MapSizeDef {
  id: string
  name: string
  size: number
}

export interface TerrainPresetDef {
  id: string
  name: string
  description: string
  heightScale: number
  mountainEdge: number
  mountainLevel: number
  waterLevel: number
  rivers: number
  forest: number
  rocks: number
  deposits: Partial<Record<'stone' | 'iron' | 'coal' | 'copper', number>>
}

export interface MapGenDef {
  defaultSize: string
  defaultTerrain: string
  sizes: MapSizeDef[]
  terrains: TerrainPresetDef[]
}

export interface ResearchUnlocks {
  buildings?: string[]
  roads?: string[]
  networks?: string[]
  /** Conduit grades by id (see NetworkDef.upgrades). */
  conduits?: string[]
  recipes?: string[]
}

export interface ResearchDef {
  id: string
  name: string
  description: string
  /** Column in the research tree. */
  tier: number
  points: number
  requires: string[]
  unlocks: ResearchUnlocks
  /** Cannot be researched: only an expedition can bring the plans home (see forges.json blueprints). */
  salvage?: boolean
}

export interface DispatchDef {
  id: string
  title: string
  /** May contain {colony}, replaced by the colony's name. */
  text: string
  /**
   * Exactly one trigger: research completed, a building finished, a year or population reached, an act of the saga
   * begun, or `manual` for letters the simulation sends itself (forge papers, telegrams, epilogues).
   */
  when: { research?: string; building?: string; year?: number; population?: number; act?: number; manual?: boolean }
  /** Ledger volume: the Board's dispatches (default), telegrams from the answering forges, or the forge papers. */
  volume?: 'board' | 'telegrams' | 'papers'
  /** Signature; the Board's when absent. */
  from?: string
}

export interface StoryDef {
  intro: { title: string; paragraphs: string[]; signature: string }
  dispatches: DispatchDef[]
}

export interface ContentBundle {
  version: string
  rules: RulesDef
  resources: ResourceDef[]
  features: FeatureDef[]
  buildings: BuildingDef[]
  recipes: RecipeDef[]
  crops: CropDef[]
  professions: ProfessionDef[]
  events: EventDef[]
  difficulty: DifficultyCatalog
  mapgen: MapGenDef
  research: ResearchDef[]
  story: StoryDef
  guilds: GuildDef[]
  petitions: PetitionDef[]
  forges: ForgesDef
}

/** What an expedition may find at a forge of this fate, and how dangerous the voyage is. */
export interface ForgeFateDef {
  id: string
  name: string
  description: string
  /** Chance each crew member is lost on the voyage; the whole ship is lost at danger × chart.shipLossFactor. */
  danger: number
  /** Salvage per resource as [min, max]. */
  salvage: Record<string, [number, number]>
  survivors: [number, number]
}

/** A telegraph request from an answering forge: send these goods before the deadline and it sends something back. */
export interface ForgeRequestDef {
  id: string
  text: string
  wants: Stock
  gives: Stock
  months: number
}

/** One of the eleven forges sent north before the colony's own. */
export interface ForgeDef {
  id: string
  number: number
  name: string
  fate: string
  /** The fate stays unknown until an expedition arrives. */
  hidden?: boolean
  /** Voyage distance range in leagues; the colony's seed places the forge within it. */
  leagues: [number, number]
  /** Found by the first expedition: a relic, salvage-only research, and forge papers (story dispatch ids). */
  relic?: string
  blueprint?: string
  papers?: string[]
  /** Answering forges: who writes, the first telegram, requests, and what becomes of them if they are failed. */
  persona?: string
  greeting?: string
  requests?: ForgeRequestDef[]
  failFate?: string
  /** Telegram sent as the forge falls silent when the creep begins (Act III). */
  silencedInAct3?: string
}

export type RelicEffect = { kind: 'winterSeverity' | 'hqOutput' | 'research' | 'automatonWork' | 'soot'; factor: number }

export interface RelicDef {
  id: string
  name: string
  description: string
  effect: RelicEffect
}

/** The Steamforge's pressure creep in Act III, and the finale's two answers to it. */
export interface CreepRules {
  /** Core pressure gained per month (rupture at 1). */
  perMonth: number
  /** A safety valve on the Steamforge's grid slows the creep by this factor. */
  valveFactor: number
  /** Extra Steamforge output per unit of creep. */
  outputBonus: number
  warnings: number[]
  retrofitMonths: number
  /** Steamforge output multiplier once retrofitted. */
  retrofitOutput: number
  /** Engineers' Institute standing needed to begin the retrofit. */
  retrofitStanding: number
  /** Monthly chance of a rupture during the retrofit while the Brotherhood works to rule. */
  retrofitSabotageChance: number
  ruptureRadius: number
  ruptureKillRadius: number
}

export interface SagaRules {
  act2Year: number
  act3Year: number
  papersForAct3: number
  creepPapers: string[]
  relationStart: number
  relationHelp: number
  relationMissed: number
  relationDecayPerYear: number
  requestEveryMonths: [number, number]
  creep: CreepRules
}

export interface ForgesDef {
  chart: {
    name: string
    leaguesPerMonth: number
    crew: [number, number]
    launchCost: Stock
    maxExpeditions: number
    shipLossFactor: number
    /** Salvage from a forge already visited, as a share of a first visit. */
    revisitSalvage: number
  }
  fates: ForgeFateDef[]
  forges: ForgeDef[]
  relics: RelicDef[]
  saga: SagaRules
}

export interface AuthResponse {
  accountId: string
  displayName: string
  kind: AccountKind
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
}

export interface Profile {
  accountId: string
  displayName: string
  kind: AccountKind
  settings: Record<string, unknown>
  version: number
}

export interface SaveSummary {
  slot: number
  name: string
  summary: string
  difficulty: string
  year: number
  population: number
  contentVersion: string
  saveVersion: number
  sizeBytes: number
  updatedAt: string
  version: number
}

export interface SaveDetails extends SaveSummary {
  data: string
}

export interface ColonyRecord {
  difficulty: string
  coloniesFounded: number
  bestYears: number
  peakPopulation: number
  updatedAt: string
}

export interface ProblemDetails {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}
