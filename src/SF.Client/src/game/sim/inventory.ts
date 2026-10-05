import type { ResourceCategory } from '../../api/types'
import type { Simulation } from './simulation'
import type { Building, Stock } from './types'

export interface StorageConfig {
  capacity: number
  accepts: ResourceCategory[]
}

export function amount(stock: Stock, res: string): number {
  return stock[res] ?? 0
}

export function addStock(stock: Stock, res: string, qty: number): void {
  const next = (stock[res] ?? 0) + qty
  if (next <= 1e-6) delete stock[res]
  else stock[res] = next
}

export function total(stock: Stock): number {
  let sum = 0
  for (const k in stock) sum += stock[k]
  return sum
}

/** Stock that is physically present and not promised to a pickup. */
export function available(b: Building, res: string): number {
  return Math.max(0, amount(b.stock, res) - amount(b.reserved, res))
}

export function storageConfig(sim: Simulation, b: Building): StorageConfig | undefined {
  return sim.component<StorageConfig>(b, 'storage')
}

export function accepts(sim: Simulation, b: Building, res: string): boolean {
  const cfg = storageConfig(sim, b)
  const category = sim.resource(res)?.category
  return !!cfg && !!category && cfg.accepts.includes(category)
}

export function freeSpace(sim: Simulation, b: Building): number {
  const cfg = storageConfig(sim, b)
  return cfg ? cfg.capacity - total(b.stock) - total(b.incoming) : 0
}

function doorDistance(sim: Simulation, b: Building, near: number): number {
  return sim.world.distance(b.door, near)
}

/** Nearest storage that accepts the resource and has room for at least part of it. */
export function nearestStorageFor(sim: Simulation, res: string, near: number, exclude = 0): Building | null {
  let best: Building | null = null
  let bestD = Infinity
  for (const b of sim.storages()) {
    if (b.id === exclude || b.fire > 0 || !accepts(sim, b, res) || freeSpace(sim, b) < 1) continue
    const d = doorDistance(sim, b, near)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

/** Nearest storage holding at least `min` unreserved units of the resource. */
export function nearestStorageWith(sim: Simulation, res: string, near: number, min = 1, exclude = 0): Building | null {
  let best: Building | null = null
  let bestD = Infinity
  for (const b of sim.storages()) {
    if (b.id === exclude || b.fire > 0 || available(b, res) < min) continue
    const d = doorDistance(sim, b, near)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

/** How many kinds of goods a store takes: the Steamforge takes everything, a stockyard only materials and fuel. */
export function breadth(sim: Simulation, b: Building): number {
  return storageConfig(sim, b)?.accepts.length ?? 0
}

/**
 * Puts goods straight into storages near a tile (refunds, dropped loads, starting supplies), filling the nearest
 * first, or with `specialisedFirst` the stores that take the fewest kinds of goods first. Returns the quantity that
 * did not fit.
 */
export function addToStorage(sim: Simulation, res: string, qty: number, near: number, exclude = 0, specialisedFirst = false): number {
  let left = qty
  const candidates = sim
    .storages()
    .filter((b) => b.id !== exclude && accepts(sim, b, res))
    .sort((a, b) => (specialisedFirst ? breadth(sim, a) - breadth(sim, b) : 0) || doorDistance(sim, a, near) - doorDistance(sim, b, near) || a.id - b.id)
  for (const b of candidates) {
    if (left <= 0) break
    const room = Math.max(0, freeSpace(sim, b))
    const put = Math.min(room, left)
    if (put > 0) {
      addStock(b.stock, res, put)
      left -= put
    }
  }
  return left
}

export function computeTotals(sim: Simulation): Stock {
  const totals: Stock = {}
  for (const b of sim.storages()) {
    for (const res in b.stock) totals[res] = (totals[res] ?? 0) + b.stock[res]
  }
  return totals
}

const foodCache = new WeakMap<Simulation, string[]>()

export function foodIds(sim: Simulation): string[] {
  let list = foodCache.get(sim)
  if (!list) {
    list = sim.content.bundle.resources.filter((r) => r.category === 'food').map((r) => r.id)
    foodCache.set(sim, list)
  }
  return list
}

export function foodIn(sim: Simulation, b: Building, unreservedOnly = true): number {
  let sum = 0
  for (const res of foodIds(sim)) sum += unreservedOnly ? available(b, res) : amount(b.stock, res)
  return sum
}

/** Takes up to qty of a resource from storage (unreserved stock, in storage order). Returns how much was taken. */
export function takeFromStorage(sim: Simulation, res: string, qty: number): number {
  let taken = 0
  for (const b of sim.storages()) {
    if (taken >= qty) break
    const take = Math.min(qty - taken, available(b, res))
    if (take <= 0) continue
    addStock(b.stock, res, -take)
    taken += take
  }
  if (taken > 0) sim.recordConsumed(res, taken)
  return taken
}
