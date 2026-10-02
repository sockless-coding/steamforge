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

export type ModelShape = 'box' | 'cylinder' | 'cone' | 'sphere' | 'gable' | 'hip' | 'gear' | 'chimney'

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
  /** Radians per second while the building is working (gears). */
  spin?: number
  /** Brightens while the building is working (furnace mouths). */
  glow?: boolean
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

export type BuildingCategory = 'civic' | 'housing' | 'storage' | 'food' | 'resources' | 'industry'

export interface BuildingDef {
  id: string
  name: string
  category: BuildingCategory
  description: string
  size: [number, number]
  cost: { resources: Stock; work: number }
  limit?: number
  buildable?: boolean
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
  deposits: Record<'stone' | 'iron' | 'coal', number>
}

export interface MapGenDef {
  defaultSize: string
  defaultTerrain: string
  sizes: MapSizeDef[]
  terrains: TerrainPresetDef[]
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
