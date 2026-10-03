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

export interface ConduitDef {
  name: string
  description: string
  cost: Stock
  work: number
}

/** An energy network: generators and consumers joined by conduit tiles (steam pipes, copper conduits). */
export interface NetworkDef {
  id: string
  name: string
  /** Short unit label for gauges, e.g. "psi" or "volts". */
  unit: string
  color: string
  conduit: ConduitDef
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
  events: { disastersPerYear: number; blessingsPerYear: number; graceYears: number }
  roads: RoadDef[]
  networks: NetworkDef[]
  automaton: AutomatonRules
  trade: TradeRules
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
  berries: number
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
}

export interface DispatchDef {
  id: string
  title: string
  /** May contain {colony}, replaced by the colony's name. */
  text: string
  when: { research?: string; building?: string; year?: number; population?: number }
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
