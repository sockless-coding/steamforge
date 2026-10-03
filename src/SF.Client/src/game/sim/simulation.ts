import { chooseFinale, foundSaga, fulfilRequest, launchExpedition, relicFactor } from './saga'
import type { Content } from '../../api/content'
import type {
  BuildingDef,
  DifficultyModifiers,
  DifficultyPreset,
  FeatureDef,
  ResourceDef,
  RulesDef,
  SeasonDef,
} from '../../api/types'
import './components'
import { componentHandler, type ComponentHandler } from './components/registry'
import { generateMap } from './mapgen'
import { Pathfinder } from './path'
import {
  canPlace,
  footprintSize,
  occupy,
  placeBuilding,
  placeStartingBuildings,
  removeBuilding,
  refund,
} from './placement'
import { abortTask, rebuildClaims } from './tasks'
import { decodeArray, encodeArray } from './codec'
import { conduitGrades, EnergyState, gradeIndex } from './energy'
import { answerPetition } from './events'
import { createFounders, fireWorker } from './population'
import { canResearch, isUnlocked, lockedBy, researchPlan } from './research'
import { answerGuildPetition, foundGuilds, guildState, releaseAutomatons, temperament } from './guilds'
import { Rng } from './rng'
import { setWind, shiftWind, SootField, type SootSnapshot } from './soot'
import type { StoryState } from './story'
import { refreshRipeness, systems } from './systems'
import type {
  Action,
  ActionResult,
  Building,
  Citizen,
  ColonyStats,
  ConduitJob,
  NewColonyOptions,
  Notice,
  GuildPetition,
  GuildState,
  SagaState,
  Petition,
  ResearchState,
  RoadJob,
  TradeOrder,
  SimEvent,
  Stock,
} from './types'
import { MARK_CLEAR, World, type WorldSnapshot } from './world'

export const SAVE_VERSION = 8

export interface ColonySnapshot {
  v: number
  contentVersion: string
  options: NewColonyOptions
  tick: number
  rng: number
  nextId: number
  world: WorldSnapshot
  buildings: Building[]
  citizens: Citizen[]
  roadJobs: RoadJob[]
  conduitJobs: ConduitJob[]
  research: ResearchState
  story: StoryState
  credit: number
  trade: Record<string, TradeOrder>
  clearQueue: number[]
  limits: Record<string, number>
  builderTarget: number
  notices: Notice[]
  stats: ColonyStats
  weather: Simulation['weather']
  outcome: Simulation['outcome']
  petition: Petition | null
  lastDisaster: number
  /** Airborne soot and settled grime (from version 5). */
  soot?: SootSnapshot
  /** Guild standings and policies, a waiting guild petition, and the automaton pledge (from version 7). */
  guilds: Record<string, GuildState>
  guildPetition: GuildPetition | null
  noAutomatonsUntil: number
  /** The silent forges, expeditions, relics and the creeping core (from version 8). */
  saga: SagaState
}

const MAX_NOTICES = 60

/**
 * The colony. Deterministic fixed-step simulation: no Math.random, no wall clock, iteration in insertion order.
 * Player input goes through perform(); systems advance state in tick(); the renderer and HUD only read.
 */
export class Simulation {
  readonly content: Content
  readonly rules: RulesDef
  readonly options: NewColonyOptions
  readonly preset: DifficultyPreset
  readonly mods: DifficultyModifiers
  readonly world: World
  readonly path: Pathfinder
  readonly rng: Rng
  /** Seconds of game time per tick. */
  readonly dt: number
  readonly tps: number
  /** Ticks per month. */
  readonly tpm: number

  tick = 0
  nextId = 1
  buildings = new Map<number, Building>()
  citizens = new Map<number, Citizen>()
  roadJobs = new Map<number, RoadJob>()
  /** Conduit tiles ordered but not laid, keyed by tile * 8 + network index. */
  conduitJobs = new Map<number, ConduitJob>()
  research: ResearchState = { done: [], queue: [], progress: {} }
  story: StoryState = { sent: [] }
  /** Company credit, earned by exporting through an airship mast and spent on imports. */
  credit = 0
  /** Standing airship trade orders per resource. */
  trade: Record<string, TradeOrder> = {}
  /** Network topology and the last supply/demand solve. Derived; rebuilt on load. */
  readonly energy = new EnergyState()
  /** Tiles whose feature must be cleared (player marks and construction footprints). */
  clearQueue = new Set<number>()
  /** Tiles claimed by an in-progress task (features, road jobs, field plots). Rebuilt from tasks on load. */
  claimed = new Set<number>()
  limits: Record<string, number> = {}
  builderTarget = 0
  notices: Notice[] = []
  stats: ColonyStats = { births: 0, deaths: 0, arrivals: 0, peakPopulation: 0, deathsBy: {}, produced: {}, consumed: {} }
  /** Temperature jitter, cold snaps, and the wind (tiles per second, the direction it blows towards). */
  weather = { offset: 0, snapDegrees: 0, snapMonths: 0, windX: 0, windY: 0 }
  /** Coal smoke over the colony and the grime it leaves. */
  readonly soot: SootField
  /** Travellers waiting at the gate for the player's answer. */
  petition: Petition | null = null
  /** Each guild's standing and policy. */
  guilds: Record<string, GuildState> = {}
  /** A guild petition waiting for the player's answer. */
  guildPetition: GuildPetition | null = null
  /** No automaton is assembled before this month index (a pledge to the guilds). */
  noAutomatonsUntil = 0
  /** The story beyond the charter: forges, expeditions, relics, the creeping core. */
  saga: SagaState
  /** Month index of the last disaster (spacing between disasters). */
  lastDisaster = -1000
  outcome: 'playing' | 'lost' = 'playing'
  /** Storage totals, refreshed every second. */
  totals: Stock = {}
  housingDirty = true
  jobsDirty = true

  private events: SimEvent[] = []
  private noticeId = 1
  private readonly componentCache = new Map<string, [ComponentHandler, unknown][]>()
  private storageCache: number[] | null = null
  private readonly featureCodes = new Map<string, number>()

  private constructor(content: Content, options: NewColonyOptions, world: World) {
    this.content = content
    this.rules = content.bundle.rules
    this.options = options
    this.preset = content.presets.get(options.difficulty) ?? content.presets.get(content.bundle.difficulty.defaultPreset)!
    this.mods = this.preset.modifiers
    this.world = world
    world.roadSpeeds = this.rules.roads.map((r) => r.speed)
    this.path = new Pathfinder(world)
    this.rng = new Rng(options.seed)
    this.tps = this.rules.ticksPerSecond
    this.dt = 1 / this.tps
    this.tpm = this.rules.secondsPerMonth * this.tps
    content.bundle.features.forEach((f, i) => this.featureCodes.set(f.id, i + 1))
    this.soot = new SootField(world.width, world.height, this.rules.soot.cellSize)
    this.saga = foundSaga(content)
  }

  /** Founds a new colony: generates the map, the Guildhall, starting buildings, supplies and families. */
  static create(content: Content, options: NewColonyOptions): Simulation {
    const gen = content.bundle.mapgen
    const size = (gen.sizes.find((s) => s.id === options.mapSize) ?? gen.sizes.find((s) => s.id === gen.defaultSize)!).size
    const terrain = gen.terrains.find((t) => t.id === options.terrain) ?? gen.terrains.find((t) => t.id === gen.defaultTerrain)!
    const map = generateMap(content, options.seed, size, terrain, content.bundle.rules.startingArea)
    const sim = new Simulation(content, options, map.world)
    sim.builderTarget = sim.rules.startingBuilders
    sim.research.done = (sim.preset.startingResearch ?? []).filter((id) => content.research.has(id))
    for (const r of content.bundle.resources) {
      if (r.defaultLimit > 0) sim.limits[r.id] = r.defaultLimit
    }
    refreshRipeness(sim)
    shiftWind(sim)
    sim.guilds = foundGuilds(sim, temperament(sim).startingStanding)
    placeStartingBuildings(sim, map.spawnX, map.spawnY)
    createFounders(sim, map.spawnX, map.spawnY)
    for (const system of systems) system.restore?.(sim)
    sim.notify('info', `${options.name} is founded around its Steamforge. Build homes before the first winter and set engineers to work at a Drafting Office.`)
    return sim
  }

  // ---------------------------------------------------------------- content lookups

  /** The colony's headquarters (the Steamforge). */
  headquarters(): Building | undefined {
    for (const b of this.buildings.values()) if (this.def(b).headquarters) return b
    return undefined
  }

  def(b: Building | string): BuildingDef {
    return this.content.buildings.get(typeof b === 'string' ? b : b.def)!
  }

  resource(id: string): ResourceDef | undefined {
    return this.content.resources.get(id)
  }

  featureCode(id: string): number {
    return this.featureCodes.get(id) ?? 0
  }

  featureDef(code: number): FeatureDef | undefined {
    return code > 0 ? this.content.bundle.features[code - 1] : undefined
  }

  /** Handlers and configs for a building's components, in definition order. */
  components(b: Building | string): [ComponentHandler, unknown][] {
    const id = typeof b === 'string' ? b : b.def
    let list = this.componentCache.get(id)
    if (!list) {
      list = []
      for (const [kind, cfg] of Object.entries(this.def(id).components)) {
        const handler = componentHandler(kind)
        if (handler) list.push([handler, cfg])
      }
      this.componentCache.set(id, list)
    }
    return list
  }

  component<C>(b: Building | string, kind: string): C | undefined {
    return this.def(b).components[kind] as C | undefined
  }

  /** Active (completed) buildings with a storage component, in id order. */
  storages(): Building[] {
    if (!this.storageCache) {
      this.storageCache = []
      for (const b of this.buildings.values()) {
        if (!b.site && this.def(b).components.storage) this.storageCache.push(b.id)
      }
    }
    return this.storageCache.map((id) => this.buildings.get(id)!).filter(Boolean)
  }

  invalidateStorages(): void {
    this.storageCache = null
  }

  // ---------------------------------------------------------------- time

  get second(): number {
    return Math.floor(this.tick / this.tps)
  }

  get monthIndex(): number {
    return Math.floor(this.tick / this.tpm)
  }

  get month(): number {
    return this.monthIndex % this.rules.months.length
  }

  get year(): number {
    return Math.floor(this.monthIndex / this.rules.months.length) + 1
  }

  /** Fraction of the current month elapsed. */
  get monthProgress(): number {
    return (this.tick % this.tpm) / this.tpm
  }

  /** Game seconds in one day. */
  get dayLength(): number {
    return this.rules.secondsPerMonth / this.rules.day.daysPerMonth
  }

  /** Fraction of the current day elapsed, 0 at midnight. Months begin at noon, so a colony is founded in daylight. */
  get dayProgress(): number {
    return (this.monthProgress * this.rules.day.daysPerMonth + 0.5) % 1
  }

  /** Share of today between sunrise and sunset. */
  get daylight(): number {
    return this.rules.day.daylight[this.month]
  }

  /** Height of the sun: 1 at noon, 0 at sunrise and sunset, -1 at midnight. */
  get sun(): number {
    const p = this.dayProgress
    const d = this.daylight
    const rise = 0.5 - d / 2
    if (p >= rise && p <= 1 - rise) return Math.sin((Math.PI * (p - rise)) / d)
    const sinceSunset = (p - (1 - rise) + 1) % 1
    return -Math.sin((Math.PI * sinceSunset) / (1 - d))
  }

  /** Between sunset and sunrise: citizens sleep unless their work is lit. */
  get isNight(): boolean {
    return this.sun < 0
  }

  /** Game seconds until the next sunrise (0 by day). */
  secondsUntilDawn(): number {
    if (!this.isNight) return 0
    const rise = 0.5 - this.daylight / 2
    return ((rise - this.dayProgress + 1) % 1) * this.dayLength
  }

  get season(): SeasonDef {
    const m = this.month
    return this.rules.seasons.find((s) => s.months.includes(m)) ?? this.rules.seasons[0]
  }

  /** Effective temperature (°C): monthly base, weather and cold snaps, with winters sharpened by difficulty. */
  get temperature(): number {
    const comfort = this.rules.citizen.comfortTemperature
    let t = this.rules.temperature[this.month] + this.weather.offset + (this.weather.snapMonths > 0 ? this.weather.snapDegrees : 0)
    if (t < comfort) t = comfort - (comfort - t) * this.mods.winterSeverity * relicFactor(this, 'winterSeverity')
    return t
  }

  /** 0 when comfortable, about 1 at -8 °C. */
  get coldness(): number {
    return Math.max(0, this.rules.citizen.comfortTemperature - this.temperature) / 20
  }

  // ---------------------------------------------------------------- events

  emit(event: SimEvent): void {
    this.events.push(event)
  }

  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  notify(level: Notice['level'], text: string, at?: number, dispatch?: string): void {
    const notice: Notice = { id: this.noticeId++, tick: this.tick, level, text, at }
    if (dispatch) notice.dispatch = dispatch
    this.notices.push(notice)
    if (this.notices.length > MAX_NOTICES) this.notices.shift()
    this.emit({ type: 'notice', notice })
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    if (this.outcome !== 'playing') return
    this.tick++
    this.path.searches = 0
    for (const s of systems) s.tick?.(this)
    if (this.tick % this.tps === 0) {
      for (const s of systems) s.second?.(this)
    }
    if (this.tick % this.tpm === 0) {
      this.emit({ type: 'month', month: this.month, year: this.year })
      for (const s of systems) s.month?.(this)
    }
  }

  // ---------------------------------------------------------------- commands

  /** Applies a player command. Every command is valid while paused; effects unfold as time runs. */
  perform(action: Action): ActionResult {
    switch (action.type) {
      case 'place': {
        const def = this.content.buildings.get(action.def)
        if (!def) return { ok: false, reason: 'Unknown building.' }
        const check = canPlace(this, def, action.x, action.y, action.rot, action.w, action.h)
        if (!check.ok) return check
        const [w, h] = footprintSize(def, action.rot, action.w, action.h)
        const b = placeBuilding(this, def, action.x, action.y, action.rot, w, h, false)
        return { ok: true, building: b.id }
      }
      case 'road': {
        const road = this.rules.roads.findIndex((r) => r.id === action.road)
        if (road < 0) return { ok: false, reason: 'Unknown road.' }
        const roadLock = lockedBy(this, 'road', action.road)
        if (roadLock) return { ok: false, reason: `Requires research: ${roadLock.name}.` }
        let placed = 0
        for (const tile of action.tiles) {
          if (tile < 0 || tile >= this.world.size) continue
          if (!this.world.isLand(tile) || this.world.building[tile] !== 0) continue
          if (this.world.road[tile] === road + 1 || this.roadJobs.get(tile)?.road === action.road) continue
          this.roadJobs.set(tile, { tile, road: action.road, delivered: false })
          this.queueClear(tile)
          placed++
        }
        return placed > 0 ? { ok: true } : { ok: false, reason: 'Nothing to build there.' }
      }
      case 'removeRoad': {
        for (const tile of action.tiles) {
          if (this.roadJobs.delete(tile)) continue
          if (this.world.road[tile] !== 0) {
            this.world.road[tile] = 0
            this.world.version++
            this.emit({ type: 'road', tile })
          }
        }
        return { ok: true }
      }
      case 'conduit': {
        const at = gradeIndex(this, action.network, action.grade)
        if (!at) return { ok: false, reason: 'Unknown network or conduit.' }
        const { n, g } = at
        const lock = lockedBy(this, 'network', action.network) ?? (g > 0 ? lockedBy(this, 'conduit', action.grade!) : null)
        if (lock) return { ok: false, reason: `Requires research: ${lock.name}.` }
        let placed = 0
        for (const tile of action.tiles) {
          if (tile < 0 || tile >= this.world.size) continue
          if (!this.world.isLand(tile) || this.world.building[tile] !== 0) continue
          // Skip tiles that already carry, or are about to carry, this grade; a conduit of another grade is re-laid.
          if (this.world.conduit[tile] & (1 << n) && this.world.gradeOf(n, tile) === g) continue
          const job = this.conduitJobs.get(tile * 8 + n)
          if (job && gradeIndex(this, job.network, job.grade)?.g === g) continue
          this.conduitJobs.set(tile * 8 + n, g > 0 ? { tile, network: action.network, grade: action.grade } : { tile, network: action.network })
          this.queueClear(tile)
          this.emit({ type: 'conduit', tile })
          placed++
        }
        return placed > 0 ? { ok: true } : { ok: false, reason: 'Nothing to lay there.' }
      }
      case 'removeConduit': {
        const n = this.rules.networks.findIndex((x) => x.id === action.network)
        if (n < 0) return { ok: false, reason: 'Unknown network.' }
        for (const tile of action.tiles) {
          if (tile < 0 || tile >= this.world.size) continue
          if (this.conduitJobs.delete(tile * 8 + n)) this.emit({ type: 'conduit', tile })
          else if (this.world.conduit[tile] & (1 << n)) {
            this.world.conduit[tile] &= ~(1 << n)
            this.energy.dirty = true
            this.emit({ type: 'conduit', tile })
          }
        }
        return { ok: true }
      }
      case 'research': {
        const tech = this.content.research.get(action.tech)
        if (!tech) return { ok: false, reason: 'Unknown research.' }
        if (this.research.done.includes(tech.id)) return { ok: false, reason: `${tech.name} is already researched.` }
        if (tech.salvage) return { ok: false, reason: `${tech.name} cannot be researched: an expedition must find the plans.` }
        this.research.queue = researchPlan(this, tech.id)
        return { ok: true }
      }
      case 'clearResearch': {
        this.research.queue = []
        return { ok: true }
      }
      case 'setTrade': {
        const res = this.resource(action.res)
        if (!res?.value) return { ok: false, reason: 'The Company does not trade in that.' }
        if (action.mode === 'none') delete this.trade[action.res]
        else this.trade[action.res] = { mode: action.mode, amount: Math.max(0, Math.min(99999, Math.round(action.amount))) }
        return { ok: true }
      }
      case 'markClear': {
        for (const tile of action.tiles) {
          if (tile < 0 || tile >= this.world.size || this.world.feature[tile] === 0) continue
          if (action.clear) this.queueClear(tile)
          else if (this.world.building[tile] === 0 && !this.roadJobs.has(tile)) {
            this.world.mark[tile] &= ~MARK_CLEAR
            this.clearQueue.delete(tile)
            this.emit({ type: 'feature', tile })
          }
        }
        return { ok: true }
      }
      case 'demolish': {
        const b = this.buildings.get(action.building)
        if (!b) return { ok: false, reason: 'No such building.' }
        if (this.def(b).headquarters) return { ok: false, reason: `The ${this.def(b).name} cannot be demolished.` }
        refund(this, b, b.site ? 1 : this.rules.construction.refundOnDemolish)
        removeBuilding(this, b)
        return { ok: true }
      }
      case 'cancelSite': {
        const b = this.buildings.get(action.building)
        if (!b?.site) return { ok: false, reason: 'Not a construction site.' }
        refund(this, b, 1)
        removeBuilding(this, b)
        return { ok: true }
      }
      case 'prioritise': {
        const b = this.buildings.get(action.building)
        if (!b?.site) return { ok: false, reason: 'Not a construction site.' }
        b.site.priority = action.priority
        this.emit({ type: 'building', id: b.id, change: 'changed' })
        return { ok: true }
      }
      case 'setWorkers': {
        const b = this.buildings.get(action.building)
        const max = b ? this.maxWorkers(b) : 0
        if (!b || max === 0) return { ok: false, reason: 'This building has no workers.' }
        b.workerTarget = Math.max(0, Math.min(max, Math.round(action.count)))
        while (b.workers.length > b.workerTarget) fireWorker(this, b.workers[b.workers.length - 1])
        this.jobsDirty = true
        return { ok: true }
      }
      case 'setBuilders': {
        this.builderTarget = Math.max(0, Math.min(500, Math.round(action.count)))
        this.jobsDirty = true
        return { ok: true }
      }
      case 'setLimit': {
        if (!this.resource(action.res)) return { ok: false, reason: 'Unknown resource.' }
        if (action.limit <= 0) delete this.limits[action.res]
        else this.limits[action.res] = Math.min(99999, Math.round(action.limit))
        return { ok: true }
      }
      case 'answerGuildPetition': {
        if (!this.guildPetition) return { ok: false, reason: 'No guild is waiting for an answer.' }
        return answerGuildPetition(this, action.choice) ? { ok: true } : { ok: false, reason: 'No such answer.' }
      }
      case 'launchExpedition': {
        const reason = launchExpedition(this, action.forge, Math.round(action.crew))
        return reason ? { ok: false, reason } : { ok: true }
      }
      case 'fulfilRequest': {
        const reason = fulfilRequest(this, action.forge)
        return reason ? { ok: false, reason } : { ok: true }
      }
      case 'finale': {
        const reason = chooseFinale(this, action.choice)
        return reason ? { ok: false, reason } : { ok: true }
      }
      case 'setGuildPolicy': {
        const guild = this.content.guilds.get(action.guild)
        if (!guild) return { ok: false, reason: 'No such guild.' }
        guildState(this, guild.id).mechanise = action.mechanise
        if (!action.mechanise) releaseAutomatons(this, guild.id)
        this.jobsDirty = true
        return { ok: true }
      }
      case 'answerPetition': {
        if (!this.petition) return { ok: false, reason: 'Nobody is waiting at the gate.' }
        answerPetition(this, action.accept)
        return { ok: true }
      }
      case 'setOption': {
        const b = this.buildings.get(action.building)
        if (!b) return { ok: false, reason: 'No such building.' }
        for (const [handler, cfg] of this.components(b)) {
          if (handler.option?.(this, b, cfg, action.key, action.value)) {
            this.emit({ type: 'building', id: b.id, change: 'changed' })
            return { ok: true }
          }
        }
        return { ok: false, reason: 'Option not available.' }
      }
    }
  }

  queueClear(tile: number): void {
    if (this.world.feature[tile] === 0) return
    this.world.mark[tile] |= MARK_CLEAR
    this.clearQueue.add(tile)
    this.emit({ type: 'feature', tile })
  }

  maxWorkers(b: Building): number {
    const workplace = this.component<{ workers: number }>(b, 'workplace')
    if (!workplace) return 0
    for (const [handler, cfg] of this.components(b)) {
      const n = handler.workers?.(this, b, cfg)
      if (n !== undefined) return Math.min(workplace.workers, n)
    }
    return workplace.workers
  }

  /** Whether producing more of a resource would exceed the player's production limit. */
  atLimit(res: string): boolean {
    const limit = this.limits[res]
    return limit !== undefined && (this.totals[res] ?? 0) >= limit
  }

  // ---------------------------------------------------------------- queries for UI

  /** People (automatons are counted separately and never homeless). */
  population(): { total: number; adults: number; children: number; elders: number; homeless: number; automatons: number } {
    const c = this.rules.citizen
    let adults = 0
    let children = 0
    let elders = 0
    let homeless = 0
    let automatons = 0
    for (const p of this.citizens.values()) {
      if (p.automaton) {
        automatons++
        continue
      }
      if (p.age < c.adultAge * 12) children++
      else if (p.age >= c.elderAge * 12) elders++
      else adults++
      if (!p.home) homeless++
    }
    return { total: this.citizens.size - automatons, adults, children, elders, homeless, automatons }
  }

  // ---------------------------------------------------------------- persistence

  serialize(): ColonySnapshot {
    return {
      v: SAVE_VERSION,
      contentVersion: this.content.bundle.version,
      options: this.options,
      tick: this.tick,
      rng: this.rng.state32,
      nextId: this.nextId,
      world: this.world.serialize(),
      buildings: [...this.buildings.values()],
      citizens: [...this.citizens.values()],
      roadJobs: [...this.roadJobs.values()],
      conduitJobs: [...this.conduitJobs.values()],
      research: this.research,
      story: this.story,
      credit: this.credit,
      trade: this.trade,
      clearQueue: [...this.clearQueue],
      limits: this.limits,
      builderTarget: this.builderTarget,
      notices: this.notices,
      stats: this.stats,
      weather: this.weather,
      outcome: this.outcome,
      petition: this.petition,
      lastDisaster: this.lastDisaster,
      soot: this.soot.serialize(),
      guilds: this.guilds,
      guildPetition: this.guildPetition,
      noAutomatonsUntil: this.noAutomatonsUntil,
      saga: this.saga,
    }
  }

  static deserialize(content: Content, snapshot: ColonySnapshot): Simulation {
    // Round-trip through JSON so the live simulation never aliases the snapshot object.
    const s = migrate(content, JSON.parse(JSON.stringify(snapshot)) as ColonySnapshot)
    const sim = new Simulation(content, s.options, World.deserialize(s.world))
    sim.tick = s.tick
    sim.rng.state32 = s.rng
    sim.nextId = s.nextId
    for (const b of s.buildings) {
      sim.buildings.set(b.id, b)
      occupy(sim, b)
    }
    for (const c of s.citizens) sim.citizens.set(c.id, c)
    for (const r of s.roadJobs) sim.roadJobs.set(r.tile, r)
    for (const j of s.conduitJobs) sim.conduitJobs.set(j.tile * 8 + sim.rules.networks.findIndex((n) => n.id === j.network), j)
    sim.research = s.research
    sim.story = s.story
    sim.credit = s.credit
    sim.trade = s.trade
    sim.clearQueue = new Set(s.clearQueue)
    sim.limits = s.limits
    sim.builderTarget = s.builderTarget
    sim.notices = s.notices
    sim.noticeId = (s.notices.at(-1)?.id ?? 0) + 1
    sim.stats = s.stats
    sim.weather = s.weather
    sim.outcome = s.outcome
    sim.petition = s.petition
    sim.lastDisaster = s.lastDisaster
    sim.soot.load(s.soot)
    sim.guilds = s.guilds
    sim.guildPetition = s.guildPetition
    sim.noAutomatonsUntil = s.noAutomatonsUntil
    sim.saga = s.saga
    rebuildClaims(sim)
    // Rebuild derived caches only; advancing anything here would make a loaded colony diverge.
    for (const system of systems) system.restore?.(sim)
    return sim
  }

  recordProduced(res: string, qty: number): void {
    this.stats.produced[res] = (this.stats.produced[res] ?? 0) + qty
  }

  recordConsumed(res: string, qty: number): void {
    this.stats.consumed[res] = (this.stats.consumed[res] ?? 0) + qty
  }

  /** Whether research has unlocked a building (or it never needed any). */
  unlocked(defId: string): boolean {
    return isUnlocked(this, 'building', defId)
  }

  /** Research that can be started right now. */
  availableResearch(): string[] {
    return this.content.bundle.research.filter((t) => canResearch(this, t)).map((t) => t.id)
  }

  /** Drops a citizen's current task (used when jobs change). */
  interrupt(c: Citizen): void {
    if (c.task) abortTask(this, c)
  }
}

/**
 * Upgrades older snapshots one version at a time. Version 1 predates research, energy networks and the story: its
 * Guildhall becomes the headquarters, every research counts as done (a legacy colony keeps what it had built) and
 * every dispatch as already received. Version 2 predates airship trade. Version 3 predates day and night (40-second
 * months), petitions and disaster spacing. Version 4 predates soot and wind. Version 5 predates feedwater, conduit
 * grades and the food rework (see migrateV5). Version 6 predates the guilds, version 7 the Hollowmere chart.
 */
function migrate(content: Content, s: ColonySnapshot): ColonySnapshot {
  if (s.v === SAVE_VERSION) return s
  if (s.v === 1) migrateV1(content, s)
  // Version 2 predates airship trade.
  if (s.v === 2) {
    s.credit = 0
    s.trade = {}
    s.v = 3
  }
  if (s.v === 3) migrateV3(content, s)
  // Version 4 predates soot: clean skies, and the season's prevailing wind at middling strength.
  if (s.v === 4) {
    const rules = content.bundle.rules
    const month = Math.floor(s.tick / (rules.secondsPerMonth * rules.ticksPerSecond)) % rules.months.length
    const season = rules.seasons.find((x) => x.months.includes(month)) ?? rules.seasons[0]
    const probe = { weather: { ...s.weather, windX: 0, windY: 0 } } as Simulation
    setWind(probe, rules.wind.prevailing[season.id] ?? 0, (rules.wind.speed[0] + rules.wind.speed[1]) / 2)
    s.weather = probe.weather
    s.v = 5
  }
  if (s.v === 5) migrateV5(content, s)
  // Version 6 predates the guilds: they start at the preset's standing, with no petition waiting.
  if (s.v === 6) {
    const preset = content.presets.get(s.options.difficulty) ?? content.presets.get(content.bundle.difficulty.defaultPreset)
    s.guilds = foundGuilds({ content }, preset?.guildTemperament?.startingStanding ?? 55)
    s.guildPetition = null
    s.noAutomatonsUntil = 0
    s.v = 7
  }
  // Version 7 predates the Hollowmere chart: Act I, every forge as the Company knew it, no expeditions.
  if (s.v === 7) {
    s.saga = foundSaga(content)
    s.v = 8
  }
  if (s.v !== SAVE_VERSION) throw new Error(`Unsupported save version ${s.v}.`)
  return s
}

/** Version 5's networks and features, in their order then (conduit bits and feature codes index these). */
const V5_NETWORKS = ['steam', 'power']
const V5_FEATURES = ['tree', 'rock', 'ironstone', 'berries', 'mushrooms']
/** Foods that no longer exist, and the forager's hut that gathered them. */
const V5_GONE_FOODS = ['berries', 'mushrooms']
const V5_FORAGER = 'foragers-hut'

/**
 * Version 5 to 6:
 * - The water network comes first, so conduit bits are remapped by network id. Version 5 steam pipes were riveted
 *   iron, so they become iron mains.
 * - Berry bushes and mushroom rings are gone from the map, and stored berries and mushrooms become Company rations.
 * - Forager's huts are pulled down. Their workers become laborers, tasks that involved a hut are dropped (with their
 *   reservations), and half the hut's timber goes to the headquarters.
 * - Glasshouse Horticulture is gone from the research tree (glasshouses are available from the founding).
 * - A colony that had researched Steam Engines gets Hydraulics, its new requirement, and a notice that boilers now
 *   need feedwater.
 */
function migrateV5(content: Content, s: ColonySnapshot): void {
  const rules = content.bundle.rules
  const remap = V5_NETWORKS.map((id) => rules.networks.findIndex((n) => n.id === id))
  const old = decodeArray(s.world.conduit, Uint8Array)
  const conduit = new Uint8Array(old.length)
  const steam = remap[0]
  const ironGrade = steam >= 0 ? conduitGrades(rules.networks[steam]).findIndex((g) => g.id === 'iron-main') : -1
  const grades = new Uint8Array(old.length)
  for (let i = 0; i < old.length; i++) {
    V5_NETWORKS.forEach((_, k) => {
      if (old[i] & (1 << k) && remap[k] >= 0) conduit[i] |= 1 << remap[k]
    })
    if (old[i] & 1 && ironGrade > 0) grades[i] = ironGrade
  }
  s.world.conduit = encodeArray(conduit)
  s.world.grades = rules.networks.map((_, n) => (n === steam && ironGrade > 0 ? encodeArray(grades) : null))
  s.conduitJobs = s.conduitJobs.filter((j) => rules.networks.some((n) => n.id === j.network))
  for (const j of s.conduitJobs) if (j.network === 'steam' && ironGrade > 0) j.grade = 'iron-main'

  const features = decodeArray(s.world.feature, Uint8Array)
  const growth = decodeArray(s.world.growth, Uint8Array)
  const codes = V5_FEATURES.map((id) => content.bundle.features.findIndex((f) => f.id === id) + 1)
  for (let i = 0; i < features.length; i++) {
    if (features[i] === 0) continue
    const code = codes[features[i] - 1] ?? 0
    if (code === 0) growth[i] = 0
    features[i] = code
  }
  s.world.feature = encodeArray(features)
  s.world.growth = encodeArray(growth)

  const hq = s.buildings.find((b) => content.buildings.get(b.def)?.headquarters)
  const rations = content.resources.has('rations') ? 'rations' : null
  const convert = (stock: Stock | null | undefined) => {
    if (!stock) return
    for (const res of V5_GONE_FOODS) {
      const qty = stock[res]
      if (qty === undefined) continue
      delete stock[res]
      if (rations && qty > 0) stock[rations] = (stock[rations] ?? 0) + qty
    }
  }

  // Pull down forager's huts and drop every task that touched one.
  const huts = new Set(s.buildings.filter((b) => b.def === V5_FORAGER && !content.buildings.has(V5_FORAGER)).map((b) => b.id))
  const byId = new Map(s.buildings.map((b) => [b.id, b]))
  for (const c of s.citizens) {
    const t = c.task
    const touches =
      t &&
      (huts.has(t.about) ||
        t.res.some((r) => r.kind !== 'tile' && huts.has(r.b)) ||
        t.steps.some((st) => ('from' in st && huts.has(st.from)) || ('to' in st && huts.has(st.to)) || ('at' in st && st.at !== undefined && huts.has(st.at))))
    if (touches) {
      for (const r of t!.res) {
        if (r.kind === 'tile') continue
        const b = byId.get(r.b)
        if (!b || huts.has(b.id)) continue
        const sub = (stock: Stock, res: string, qty: number) => {
          stock[res] = (stock[res] ?? 0) - qty
          if (stock[res] <= 1e-6) delete stock[res]
        }
        if (r.kind === 'stock') sub(b.reserved, r.res, r.qty)
        else if (r.kind === 'incoming') sub(b.incoming, r.res, r.qty)
        else if (r.kind === 'site' && b.site) sub(b.site.incoming, r.res, r.qty)
        else if (r.kind === 'slot') b.data[r.key] = Math.max(0, ((b.data[r.key] as number | undefined) ?? 0) - 1)
      }
      c.task = null
      c.path = null
      if (c.carry && hq) for (const res in c.carry) hq.stock[res] = (hq.stock[res] ?? 0) + c.carry[res]
      c.carry = null
    }
    if (huts.has(c.workplace) || c.profession === 'forager') {
      c.workplace = 0
      if (c.profession !== 'child') c.profession = 'laborer'
    }
    c.diet = c.diet.filter((f) => !V5_GONE_FOODS.includes(f))
    convert(c.carry)
  }
  for (const id of huts) {
    const hut = byId.get(id)!
    if (hq) {
      for (const res in hut.stock) hq.stock[res] = (hq.stock[res] ?? 0) + hut.stock[res]
      if (!hut.site) hq.stock.logs = (hq.stock.logs ?? 0) + 7
    }
  }
  s.buildings = s.buildings.filter((b) => !huts.has(b.id))
  for (const b of s.buildings) {
    convert(b.stock)
    convert(b.reserved)
    convert(b.incoming)
    b.workers = b.workers.filter((w) => s.citizens.some((c) => c.id === w && c.workplace === b.id))
  }
  for (const res of V5_GONE_FOODS) {
    delete s.trade[res]
    delete s.limits[res]
  }

  // Research that no longer exists (Glasshouse Horticulture: glasshouses are available from the founding).
  const known = (id: string) => content.research.has(id)
  s.research.done = s.research.done.filter(known)
  s.research.queue = s.research.queue.filter(known)
  for (const id of Object.keys(s.research.progress)) if (!known(id)) delete s.research.progress[id]

  // Steam Engines now requires Hydraulics: boilers need feedwater.
  if (s.research.done.includes('engines') && content.research.has('hydraulics') && !s.research.done.includes('hydraulics')) {
    s.research.done.push('hydraulics')
  }
  if (s.buildings.some((b) => b.def === 'boiler-house')) {
    const id = (s.notices.at(-1)?.id ?? 0) + 1
    s.notices.push({ id, tick: s.tick, level: 'warn', text: 'Boiler houses now raise steam from feedwater. Lay water mains to them from a pump house on the shore or a windpump well.' })
  }
  s.v = 6
}

function migrateV3(content: Content, s: ColonySnapshot): void {
  // Rescale the clock so the colony keeps its date and its place within the month.
  const rules = content.bundle.rules
  const scale = (rules.secondsPerMonth * rules.ticksPerSecond) / 400
  s.tick = Math.round(s.tick * scale)
  for (const n of s.notices) n.tick = Math.round(n.tick * scale)
  for (const b of s.buildings) b.activeAt = Math.round(b.activeAt * scale)
  s.petition = null
  s.lastDisaster = -1000
  s.v = 4
}

function migrateV1(content: Content, s: ColonySnapshot): void {
  const hq = content.bundle.buildings.find((b) => b.headquarters)
  for (const b of s.buildings) {
    if (b.def === 'guildhall' && hq && !content.buildings.has('guildhall')) b.def = hq.id
    delete b.data.steam
  }
  s.world.conduit = encodeArray(new Uint8Array(s.world.width * s.world.height))
  s.conduitJobs = []
  s.research = { done: content.bundle.research.map((t) => t.id), queue: [], progress: {} }
  s.story = { sent: content.bundle.story.dispatches.map((d) => d.id) }
  s.v = 2
}
