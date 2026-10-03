import { runEffect } from './effects'
import { energyFactor } from './energy'
import { addStock, addToStorage, amount } from './inventory'
import type { Simulation } from './simulation'
import type { Building, Citizen, Reservation, Step, Task, TaskKind } from './types'

/** A* searches allowed per tick across all citizens; the rest wait a tick. */
export const PATH_BUDGET = 24
const UNREACHABLE_BACKOFF = 40

export function task(kind: TaskKind, label: string, about: number, steps: Step[], res: Reservation[] = []): Task {
  return { kind, label, steps, i: 0, t: 0, res, about }
}

export function tileOf(c: Citizen, sim: Simulation): number {
  return sim.world.index(Math.floor(c.x), Math.floor(c.y))
}

// ---------------------------------------------------------------- reservations

export function reserveStock(b: Building, res: string, qty: number): Reservation {
  addStock(b.reserved, res, qty)
  return { kind: 'stock', b: b.id, res, qty }
}

export function reserveIncoming(b: Building, res: string, qty: number): Reservation {
  addStock(b.incoming, res, qty)
  return { kind: 'incoming', b: b.id, res, qty }
}

export function reserveSite(b: Building, res: string, qty: number): Reservation {
  addStock(b.site!.incoming, res, qty)
  return { kind: 'site', b: b.id, res, qty }
}

export function claimTile(sim: Simulation, tile: number): Reservation {
  sim.claimed.add(tile)
  return { kind: 'tile', tile }
}

export function takeSlot(b: Building, key: string): Reservation {
  b.data[key] = ((b.data[key] as number) ?? 0) + 1
  return { kind: 'slot', b: b.id, key }
}

export function slotCount(b: Building, key: string): number {
  return (b.data[key] as number) ?? 0
}

export function release(sim: Simulation, r: Reservation): void {
  if (r.kind === 'tile') {
    sim.claimed.delete(r.tile)
    return
  }
  const b = sim.buildings.get(r.b)
  if (!b) return
  switch (r.kind) {
    case 'stock':
      addStock(b.reserved, r.res, -r.qty)
      break
    case 'incoming':
      addStock(b.incoming, r.res, -r.qty)
      break
    case 'site':
      if (b.site) addStock(b.site.incoming, r.res, -r.qty)
      break
    case 'slot':
      b.data[r.key] = Math.max(0, slotCount(b, r.key) - 1)
      break
  }
}

function releaseWhere(sim: Simulation, t: Task, match: (r: Reservation) => boolean): void {
  t.res = t.res.filter((r) => {
    if (!match(r)) return true
    release(sim, r)
    return false
  })
}

/** Re-derives tile claims from in-progress tasks (claims are not stored separately in saves). */
export function rebuildClaims(sim: Simulation): void {
  sim.claimed.clear()
  for (const c of sim.citizens.values()) {
    for (const r of c.task?.res ?? []) if (r.kind === 'tile') sim.claimed.add(r.tile)
  }
}

// ---------------------------------------------------------------- lifecycle

/** Puts whatever the citizen carries into the nearest storage; anything that does not fit is lost. */
export function dropCarry(sim: Simulation, c: Citizen): void {
  if (!c.carry) return
  const here = tileOf(c, sim)
  for (const res in c.carry) addToStorage(sim, res, c.carry[res], here)
  c.carry = null
}

export function abortTask(sim: Simulation, c: Citizen, backoff = 0): void {
  const t = c.task
  if (t) for (const r of t.res) release(sim, r)
  c.task = null
  c.path = null
  dropCarry(sim, c)
  c.wait = backoff
}

function finishTask(sim: Simulation, c: Citizen): void {
  const t = c.task!
  for (const r of t.res) release(sim, r)
  c.task = null
  c.path = null
  if (c.carry) dropCarry(sim, c)
}

// ---------------------------------------------------------------- per-tick execution

export function moveSpeed(sim: Simulation, c: Citizen): number {
  const r = sim.rules.citizen
  let speed = r.walkSpeed * sim.world.speed(tileOf(c, sim))
  if (c.age < r.adultAge * 12 || c.age >= r.elderAge * 12) speed *= 0.8
  if (c.health < 0.3) speed *= 0.7
  if (c.carry) speed *= 0.9
  return speed
}

export function workSpeed(sim: Simulation, c: Citizen, at?: number): number {
  const r = sim.rules.citizen
  let s = sim.mods.productionMultiplier * (0.8 + 0.3 * c.happiness)
  if (c.tools <= 0) s *= r.noToolsWorkFactor
  if (c.age >= r.elderAge * 12) s *= r.elderWorkFactor
  if (c.health < 0.4) s *= 0.7
  if (c.sick > 0) s *= 0.6
  if (at) {
    const b = sim.buildings.get(at)
    if (b) s *= energyFactor(sim, b)
  }
  return s
}

/** Advances one citizen by one tick: picks a task when idle, then runs the current step. */
export function runCitizen(sim: Simulation, c: Citizen, choose: (sim: Simulation, c: Citizen) => Task | null): void {
  c.px = c.x
  c.py = c.y
  if (!c.task) {
    if (c.wait > 0) {
      c.wait--
      return
    }
    c.task = choose(sim, c)
    if (!c.task) {
      c.wait = 10 + sim.rng.int(10)
      return
    }
  }
  const t = c.task
  const step = t.steps[t.i]
  if (!step) {
    finishTask(sim, c)
    return
  }
  if (runStep(sim, c, t, step)) {
    t.i++
    t.t = 0
    if (t.i >= t.steps.length && c.task === t) finishTask(sim, c)
  }
}

/** Returns true when the step is complete. */
function runStep(sim: Simulation, c: Citizen, t: Task, step: Step): boolean {
  switch (step.op) {
    case 'goto':
      return walk(sim, c, step.tile, step.enter)
    case 'work': {
      if (step.at) {
        const b = sim.buildings.get(step.at)
        if (!b || b.fire > 0) {
          abortTask(sim, c, 5)
          return false
        }
        b.activeAt = sim.second
      }
      t.t += sim.dt * workSpeed(sim, c, step.at)
      if (t.t < step.seconds) return false
      if (!runEffect(step.effect, sim, c, step.args ?? [])) {
        abortTask(sim, c, 10)
        return false
      }
      return true
    }
    case 'wait':
      t.t += sim.dt
      return t.t >= step.seconds
    case 'take': {
      const b = sim.buildings.get(step.from)
      releaseWhere(sim, t, (r) => r.kind === 'stock' && r.b === step.from && r.res === step.res)
      const qty = b ? Math.min(step.qty, amount(b.stock, step.res)) : 0
      if (!b || qty <= 0) {
        abortTask(sim, c, 10)
        return false
      }
      addStock(b.stock, step.res, -qty)
      c.carry ??= {}
      addStock(c.carry, step.res, qty)
      return true
    }
    case 'give': {
      const b = sim.buildings.get(step.to)
      releaseWhere(sim, t, (r) => (r.kind === 'incoming' || r.kind === 'site') && r.b === step.to)
      if (!b) {
        abortTask(sim, c, 10)
        return false
      }
      if (c.carry) {
        const target = b.site ? b.site.delivered : b.stock
        for (const res in c.carry) addStock(target, res, c.carry[res])
        c.carry = null
      }
      return true
    }
    case 'do':
      if (!runEffect(step.effect, sim, c, step.args ?? [])) {
        abortTask(sim, c, 10)
        return false
      }
      return true
  }
}

function walk(sim: Simulation, c: Citizen, goal: number, enter?: number): boolean {
  const world = sim.world
  c.inside = 0
  if (!c.path) {
    const here = tileOf(c, sim)
    if (here === goal) {
      c.x = world.xOf(goal) + 0.5
      c.y = world.yOf(goal) + 0.5
      if (enter) c.inside = enter
      return true
    }
    if (sim.path.searches >= PATH_BUDGET) return false
    const path = sim.path.find(here, goal)
    if (!path) {
      abortTask(sim, c, UNREACHABLE_BACKOFF + sim.rng.int(UNREACHABLE_BACKOFF))
      return false
    }
    c.path = path
    c.pathI = 0
  }

  let budget = moveSpeed(sim, c) * sim.dt
  while (budget > 0 && c.pathI < c.path.length) {
    const next = c.path[c.pathI]
    if (!world.walkable(next)) {
      // Something was built across the route: plan again next tick.
      c.path = null
      return false
    }
    const tx = world.xOf(next) + 0.5
    const ty = world.yOf(next) + 0.5
    const dx = tx - c.x
    const dy = ty - c.y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d <= budget) {
      c.x = tx
      c.y = ty
      budget -= d
      c.pathI++
    } else {
      c.x += (dx / d) * budget
      c.y += (dy / d) * budget
      budget = 0
    }
  }
  if (c.pathI >= c.path.length) {
    c.path = null
    if (enter) c.inside = enter
    return true
  }
  return false
}

// ---------------------------------------------------------------- step helpers

export function gotoBuilding(b: Building, enter = false): Step {
  return enter ? { op: 'goto', tile: b.door, enter: b.id } : { op: 'goto', tile: b.door }
}

/** A walkable tile at or next to the target (features inside solid footprints are worked from outside). */
export function approachTile(sim: Simulation, tile: number): number {
  const world = sim.world
  if (world.walkable(tile)) return tile
  const x = world.xOf(tile)
  const y = world.yOf(tile)
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const nx = x + dx
        const ny = y + dy
        if (world.inBounds(nx, ny) && world.walkable(world.index(nx, ny))) return world.index(nx, ny)
      }
    }
  }
  return -1
}
