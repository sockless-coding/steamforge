import { hqOutputFactor } from './saga'
import type { ConduitDef, NetworkDef } from '../../api/types'
import { amount } from './inventory'
import type { Simulation } from './simulation'
import type { Building } from './types'

export interface GeneratorConfig {
  network: string
  /** Energy delivered at full fuel (or full input, for converters such as the dynamo). */
  output: number
  /**
   * Fuel burned per month at full load, in order of preference. Idle generators bank their fires and burn a quarter.
   * Omit for converters, which instead scale their output by how well their own consumer component is supplied.
   */
  fuel?: Record<string, number>
  /** Fuel kept on hand: fetched by the building's workers, or by laborers when it has none. */
  capacity?: number
}

export interface ConsumerConfig {
  /** Energy drawn from each network while the building is staffed (or, for homes, occupied in the cold). */
  uses: Record<string, number>
  /** Without energy the building cannot work; a partial supply slows it down. */
  required?: boolean
  /** Work speed bonus at full supply. */
  workBonus?: number
  /** Fraction of a home's firewood replaced by steam heat at full supply. */
  heatBonus?: number
}

export interface GridStatus {
  supply: number
  demand: number
}

/** Restores pressure along a main: the pump's footprint acts as a source at `head` (scaled by its own supply). */
export interface BoosterConfig {
  network: string
  head: number
}

/**
 * Derived energy state, rebuilt on load and never saved. Each network is split into grids: connected groups of
 * conduit tiles and the participating buildings they touch (buildings also join grids through their own footprint,
 * so a workshop built against a boiler needs no pipe).
 */
export class EnergyState {
  dirty = true
  /** Per network: participating building id -> grid index (1-based). */
  grids: Map<number, number>[] = []
  /** Per network, per grid index: supply and demand from the last solve. */
  status: GridStatus[][] = []
  /** Per network: totals over all grids from the last solve. */
  totals: GridStatus[] = []
  /**
   * Per network: head (0-1) at each participating building from the last solve. Pressure falls along conduits by
   * each tile's lossPerTile from the nearest lit generator (or booster pump).
   */
  heads: Map<number, number>[] = []
  /** Per network: head per tile from the last solve (conduits and participating footprints), for the overlay. */
  tileHeads: (Float32Array | null)[] = []
  /** Scratch buffers for the head search. */
  cost: Float64Array | null = null
}

/** Binary min-heap of tiles keyed by cost, ties broken by tile index (deterministic). */
class TileHeap {
  private readonly costs: number[] = []
  private readonly tiles: number[] = []

  get size(): number {
    return this.tiles.length
  }

  private less(a: number, b: number): boolean {
    return this.costs[a] < this.costs[b] || (this.costs[a] === this.costs[b] && this.tiles[a] < this.tiles[b])
  }

  private swap(a: number, b: number): void {
    ;[this.costs[a], this.costs[b]] = [this.costs[b], this.costs[a]]
    ;[this.tiles[a], this.tiles[b]] = [this.tiles[b], this.tiles[a]]
  }

  push(cost: number, tile: number): void {
    this.costs.push(cost)
    this.tiles.push(tile)
    let i = this.tiles.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.costs[0], this.tiles[0]]
    const lastCost = this.costs.pop()!
    const lastTile = this.tiles.pop()!
    if (this.tiles.length > 0) {
      this.costs[0] = lastCost
      this.tiles[0] = lastTile
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.tiles.length && this.less(l, m)) m = l
        if (r < this.tiles.length && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export function generatorOf(sim: Simulation, b: Building | string): GeneratorConfig | undefined {
  return sim.component<GeneratorConfig>(b, 'generator')
}

export function consumerOf(sim: Simulation, b: Building | string): ConsumerConfig | undefined {
  return sim.component<ConsumerConfig>(b, 'consumer')
}

/** Whether a finished building generates or consumes on a network. */
export function participates(sim: Simulation, b: Building, network: string): boolean {
  if (b.site) return false
  return generatorOf(sim, b)?.network === network || consumerOf(sim, b)?.uses[network] !== undefined
}

/** A required-energy building that has (almost) none: it cannot work. */
export function energyBlocked(sim: Simulation, b: Building): boolean {
  return !!consumerOf(sim, b)?.required && ((b.data.power as number | undefined) ?? 0) < 0.05
}

/** Work-speed factor from energy: partial supply slows required consumers, boosts speed up bonus consumers. */
export function energyFactor(sim: Simulation, b: Building): number {
  const consumer = consumerOf(sim, b)
  if (!consumer) return 1
  const power = (b.data.power as number | undefined) ?? 0
  let f = consumer.required ? power : 1
  const boost = b.data.boost as number | undefined
  if (boost) f *= 1 + boost
  return f
}

/** Whether a consumer currently draws: staffed workplaces, occupied homes in the cold, everything else always. */
function demanding(sim: Simulation, b: Building, consumer: ConsumerConfig): boolean {
  if (b.fire > 0) return false
  if (sim.def(b).components.workplace) return b.workers.length > 0
  if (sim.def(b).components.housing) return b.residents.length > 0 && (sim.coldness > 0 || !consumer.heatBonus)
  return true
}

export function networkIndex(sim: Simulation, network: string): number {
  return sim.rules.networks.findIndex((n) => n.id === network)
}

/** A network's conduit grades: the basic conduit first, then its upgrades. A tile's grade indexes this list. */
export function conduitGrades(net: NetworkDef): ConduitDef[] {
  return net.upgrades ? [net.conduit, ...net.upgrades] : [net.conduit]
}

/** The grade of conduit on a tile of network n (the basic conduit for tiles without one). */
export function tileGrade(sim: Simulation, n: number, tile: number): ConduitDef {
  const grades = conduitGrades(sim.rules.networks[n])
  return grades[sim.world.gradeOf(n, tile)] ?? grades[0]
}

/** Network index and grade index of a conduit grade id within a network, or null. */
export function gradeIndex(sim: Simulation, network: string, grade: string | undefined): { n: number; g: number } | null {
  const n = networkIndex(sim, network)
  if (n < 0) return null
  if (grade === undefined) return { n, g: 0 }
  const g = conduitGrades(sim.rules.networks[n]).findIndex((c) => c.id === grade)
  return g < 0 ? null : { n, g }
}

function rebuildTopology(sim: Simulation): void {
  const world = sim.world
  const e = sim.energy
  const label = new Int32Array(world.size)
  const stack: number[] = []
  e.grids = sim.rules.networks.map((net, n) => {
    const bit = 1 << n
    const members = new Map<number, number>()
    const part = new Set<number>()
    for (const b of sim.buildings.values()) if (participates(sim, b, net.id)) part.add(b.id)
    if (part.size === 0) return members
    label.fill(0)
    const conductive = (i: number) => (world.conduit[i] & bit) !== 0 || part.has(world.building[i])
    let grid = 0
    for (const id of part) {
      const b = sim.buildings.get(id)!
      const seed = world.index(b.x, b.y)
      if (label[seed] !== 0) continue
      grid++
      label[seed] = grid
      stack.push(seed)
      while (stack.length) {
        const i = stack.pop()!
        if (part.has(world.building[i])) members.set(world.building[i], grid)
        const x = world.xOf(i)
        const y = world.yOf(i)
        for (const [dx, dy] of ORTHO) {
          const nx = x + dx
          const ny = y + dy
          if (!world.inBounds(nx, ny)) continue
          const j = world.index(nx, ny)
          if (label[j] === 0 && conductive(j)) {
            label[j] = grid
            stack.push(j)
          }
        }
      }
    }
    return members
  })
  e.dirty = false
}

function footprint(sim: Simulation, b: Building): number[] {
  const out: number[] = []
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.push(sim.world.index(x, y))
  return out
}

/**
 * Head at every participating building of network n: a cheapest-path search outward from every lit generator's
 * footprint, where each conduit tile costs its grade's lossPerTile and footprints are free. A booster pump the
 * pressure reaches becomes a new source at its rated head (times its supply), and the search continues from it, so
 * the search allows a tile's cost to improve after it was first reached. Writes e.heads[n] and e.tileHeads[n].
 */
function solveHeads(sim: Simulation, n: number, members: Map<number, number>, ratio: (id: number) => number): void {
  const e = sim.energy
  const world = sim.world
  const net = sim.rules.networks[n]
  const bit = 1 << n
  if (!e.cost || e.cost.length !== world.size) e.cost = new Float64Array(world.size)
  const cost = e.cost
  cost.fill(Infinity)
  const heap = new TileHeap()
  const grades = conduitGrades(net)
  const boosters = new Map<number, BoosterConfig>()
  const seed = (b: Building, c: number) => {
    for (const i of footprint(sim, b)) {
      if (c < cost[i]) {
        cost[i] = c
        heap.push(c, i)
      }
    }
  }
  for (const id of members.keys()) {
    const b = sim.buildings.get(id)
    if (!b) continue
    if (generatorOf(sim, b)?.network === net.id && b.data.lit === true) seed(b, 0)
    const booster = sim.component<BoosterConfig>(b, 'booster')
    if (booster?.network === net.id) boosters.set(id, booster)
  }
  const triggered = new Set<number>()
  while (heap.size > 0) {
    const [c, i] = heap.pop()
    if (c > cost[i] || c >= 1) continue
    const here = world.building[i]
    if (here && boosters.has(here) && !triggered.has(here)) {
      triggered.add(here)
      const b = sim.buildings.get(here)!
      seed(b, 1 - boosters.get(here)!.head * ratio(here))
    }
    const x = world.xOf(i)
    const y = world.yOf(i)
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx
      const ny = y + dy
      if (!world.inBounds(nx, ny)) continue
      const j = world.index(nx, ny)
      const owner = world.building[j]
      let step: number
      if (owner && members.has(owner)) step = 0
      else if (world.conduit[j] & bit) step = (grades[world.gradeOf(n, j)] ?? grades[0]).lossPerTile
      else continue
      const next = c + step
      if (next < cost[j]) {
        cost[j] = next
        heap.push(next, j)
      }
    }
  }
  const heads = new Map<number, number>()
  for (const id of members.keys()) {
    const b = sim.buildings.get(id)
    if (!b) continue
    let best = Infinity
    for (const i of footprint(sim, b)) best = Math.min(best, cost[i])
    heads.set(id, Math.max(0, 1 - best))
  }
  e.heads[n] = heads
  let tiles = e.tileHeads[n]
  if (!tiles || tiles.length !== world.size) tiles = e.tileHeads[n] = new Float32Array(world.size)
  for (let i = 0; i < world.size; i++) tiles[i] = cost[i] < 1 ? 1 - cost[i] : 0
}

/** Head (0-1) at a building on a network from the last solve; 0 when it is not on a grid. */
export function headOf(sim: Simulation, b: Building, network: string): number {
  const n = networkIndex(sim, network)
  return n >= 0 ? (sim.energy.heads[n]?.get(b.id) ?? 0) : 0
}

/**
 * Balances every grid: lit generators supply, staffed consumers demand, and each consumer gets the grid's
 * supply/demand ratio (capped at 1) times the head that reaches it along the conduits. Networks are solved in
 * content order, so a converter's input network must come before its output. With `write`, stores each building's
 * power, boost and heat and burns generator fuel; without it (on load) only the derived status is refreshed.
 */
export function solveEnergy(sim: Simulation, write: boolean): void {
  const e = sim.energy
  if (e.dirty) rebuildTopology(sim)
  const nets = sim.rules.networks
  const satisfied: Map<number, number>[] = []
  e.status = []
  e.totals = []

  nets.forEach((net, n) => {
    const members = e.grids[n] ?? new Map<number, number>()
    let count = 0
    for (const grid of members.values()) count = Math.max(count, grid)
    const status: GridStatus[] = Array.from({ length: count + 1 }, () => ({ supply: 0, demand: 0 }))
    for (const [id, grid] of members) {
      const b = sim.buildings.get(id)
      if (!b) continue
      const gen = generatorOf(sim, b)
      if (gen?.network === net.id && b.data.lit === true) {
        // The Steamforge's output answers to its relics and, in the last act, to its creeping core.
        const boost = sim.def(b).headquarters ? hqOutputFactor(sim) : 1
        status[grid].supply += gen.output * boost * inputSatisfaction(sim, b, satisfied)
      }
      const consumer = consumerOf(sim, b)
      const use = consumer?.uses[net.id]
      if (consumer && use && demanding(sim, b, consumer)) status[grid].demand += use
    }
    const ratio = (s: GridStatus) => (s.demand > 0 ? Math.min(1, s.supply / s.demand) : s.supply > 0 ? 1 : 0)
    solveHeads(sim, n, members, (id) => ratio(status[members.get(id)!]))
    const heads = e.heads[n]
    const sat = new Map<number, number>()
    for (const [id, grid] of members) sat.set(id, ratio(status[grid]) * (heads.get(id) ?? 0))
    satisfied[n] = sat
    e.status[n] = status
    e.totals[n] = status.reduce((t, s) => ({ supply: t.supply + s.supply, demand: t.demand + s.demand }), { supply: 0, demand: 0 })

    if (!write) return
    for (const [id, grid] of members) {
      const b = sim.buildings.get(id)!
      const gen = generatorOf(sim, b)
      if (gen?.network !== net.id || b.data.lit !== true || !gen.fuel) continue
      const s = status[grid]
      const load = s.supply > 0 ? Math.min(1, s.demand / s.supply) : 0
      const res = b.data.fuel as string
      const burn = ((gen.fuel[res] ?? 0) / sim.rules.secondsPerMonth) * Math.max(0.25, load)
      const used = Math.min(amount(b.stock, res), burn)
      b.stock[res] = amount(b.stock, res) - used
      if (b.stock[res] <= 1e-6) delete b.stock[res]
      sim.recordConsumed(res, used)
    }
  })

  if (!write) return
  for (const b of sim.buildings.values()) {
    const consumer = consumerOf(sim, b)
    if (!consumer || b.site) continue
    let power = 1
    for (const net of Object.keys(consumer.uses)) {
      const n = networkIndex(sim, net)
      power = Math.min(power, n >= 0 ? (satisfied[n]?.get(b.id) ?? 0) : 0)
    }
    b.data.power = power
    // Buildings that run on energy alone (clock tower, depots, valves) animate while supplied.
    if (power >= 0.5 && !sim.def(b).components.workplace && !sim.def(b).components.housing) b.activeAt = sim.second
    const boost = (consumer.workBonus ?? 0) * power
    if (boost > 0) b.data.boost = boost
    else delete b.data.boost
    const heat = (consumer.heatBonus ?? 0) * power
    if (heat > 0) b.data.heat = heat
    else delete b.data.heat
  }
}

/** For converters (a generator that is also a consumer): the share of its input it receives. 1 otherwise. */
function inputSatisfaction(sim: Simulation, b: Building, satisfied: Map<number, number>[]): number {
  const consumer = consumerOf(sim, b)
  if (!consumer) return 1
  let s = 1
  for (const net of Object.keys(consumer.uses)) {
    const n = networkIndex(sim, net)
    s = Math.min(s, n >= 0 ? (satisfied[n]?.get(b.id) ?? 0) : 0)
  }
  return s
}

/**
 * Whether a footprint would join an existing grid: a conduit or a participating building on the network touches
 * one of its edges. Used by the placement preview; reads only.
 */
export function touchesGrid(sim: Simulation, x: number, y: number, w: number, h: number, network: string): boolean {
  const n = networkIndex(sim, network)
  if (n < 0) return false
  const world = sim.world
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      const edge = tx === x - 1 || ty === y - 1 || tx === x + w || ty === y + h
      const corner = (tx === x - 1 || tx === x + w) && (ty === y - 1 || ty === y + h)
      if (!edge || corner || !world.inBounds(tx, ty)) continue
      const i = world.index(tx, ty)
      if (world.conduit[i] & (1 << n)) return true
      const b = world.building[i] ? sim.buildings.get(world.building[i]) : undefined
      if (b && participates(sim, b, network)) return true
    }
  }
  return false
}

/** The supply/demand of the grid a building belongs to on a network, if any. */
export function gridOf(sim: Simulation, b: Building, network: string): GridStatus | null {
  const n = networkIndex(sim, network)
  const grid = sim.energy.grids[n]?.get(b.id)
  return grid ? (sim.energy.status[n]?.[grid] ?? null) : null
}
