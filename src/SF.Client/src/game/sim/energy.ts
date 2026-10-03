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

/**
 * Balances every grid: lit generators supply, staffed consumers demand, and each consumer gets the grid's
 * supply/demand ratio (capped at 1). Networks are solved in content order, so a converter's input network must
 * come before its output. With `write`, stores each building's power, boost and heat and burns generator fuel;
 * without it (on load) only the derived status is refreshed.
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
      if (gen?.network === net.id && b.data.lit === true) status[grid].supply += gen.output * inputSatisfaction(sim, b, satisfied)
      const consumer = consumerOf(sim, b)
      const use = consumer?.uses[net.id]
      if (consumer && use && demanding(sim, b, consumer)) status[grid].demand += use
    }
    const ratio = (s: GridStatus) => (s.demand > 0 ? Math.min(1, s.supply / s.demand) : s.supply > 0 ? 1 : 0)
    const sat = new Map<number, number>()
    for (const [id, grid] of members) sat.set(id, ratio(status[grid]))
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
