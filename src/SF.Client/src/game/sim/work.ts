import { amount, available, nearestStorageFor, nearestStorageWith } from './inventory'
import type { Simulation } from './simulation'
import { gotoBuilding, reserveIncoming, reserveStock, task, tileOf } from './tasks'
import type { Building, Citizen, Task, TaskKind } from './types'

/** Resources a building produces into its own stock, as declared by its component handlers. */
export function outputsOf(sim: Simulation, b: Building): string[] {
  const out: string[] = []
  for (const [handler, cfg] of sim.components(b)) {
    for (const res of handler.outputs?.(sim, b, cfg) ?? []) if (!out.includes(res)) out.push(res)
  }
  return out
}

/** Total output held at a workplace. */
export function outputHeld(sim: Simulation, b: Building): number {
  let sum = 0
  for (const res of outputsOf(sim, b)) sum += amount(b.stock, res)
  return sum
}

export function outputFull(sim: Simulation, b: Building): boolean {
  return outputHeld(sim, b) >= sim.rules.workplace.outputBuffer
}

/** The output buffer is full and no storage has room for any of it, so the workers stand idle. */
export function storageBlocked(sim: Simulation, b: Building): boolean {
  if (!outputFull(sim, b)) return false
  return outputsOf(sim, b).every((res) => available(b, res) < 1 || !nearestStorageFor(sim, res, b.door))
}

/** Carries a building's largest unreserved output to the nearest storage with room. */
export function haulOutputTask(sim: Simulation, _c: Citizen, b: Building, min: number, kind: TaskKind = 'work'): Task | null {
  let best = ''
  let bestQty = 0
  for (const res of outputsOf(sim, b)) {
    const qty = available(b, res)
    if (qty >= min && qty > bestQty) {
      best = res
      bestQty = qty
    }
  }
  if (!best) return null
  const store = nearestStorageFor(sim, best, b.door)
  if (!store) return null
  const qty = Math.min(bestQty, sim.rules.citizen.carry)
  const label = `Hauling ${sim.resource(best)?.name.toLowerCase() ?? best}`
  return task(kind, label, b.id, [gotoBuilding(b), { op: 'take', from: b.id, res: best, qty }, gotoBuilding(store), { op: 'give', to: store.id }], [
    reserveStock(b, best, qty),
    reserveIncoming(store, best, qty),
  ])
}

/**
 * Brings a resource from the nearest storage into a building (workplace inputs, boiler fuel). `want` is how much
 * the building still needs after counting stock and deliveries already on the way.
 */
export function fetchIntoTask(sim: Simulation, _c: Citizen, b: Building, res: string, want: number, kind: TaskKind = 'work'): Task | null {
  if (want < 1) return null
  const source = nearestStorageWith(sim, res, b.door)
  if (!source) return null
  const qty = Math.min(want, sim.rules.citizen.carry, available(source, res))
  if (qty < 1) return null
  const label = `Fetching ${sim.resource(res)?.name.toLowerCase() ?? res}`
  return task(kind, label, b.id, [gotoBuilding(source), { op: 'take', from: source.id, res, qty }, gotoBuilding(b), { op: 'give', to: b.id }], [
    reserveStock(source, res, qty),
    reserveIncoming(b, res, qty),
  ])
}

/** Units of a resource a building has or is about to receive. */
export function onHand(b: Building, res: string): number {
  return amount(b.stock, res) + amount(b.incoming, res)
}

export function distanceTo(sim: Simulation, c: Citizen, tile: number): number {
  return sim.world.distance(tileOf(c, sim), tile)
}
