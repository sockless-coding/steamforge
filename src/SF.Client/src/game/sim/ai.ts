import { amount, available, foodIds, foodIn, nearestStorageFor, nearestStorageWith } from './inventory'
import { deliveredFraction, totalWork } from './placement'
import type { Simulation } from './simulation'
import {
  approachTile,
  claimTile,
  gotoBuilding,
  reserveIncoming,
  reserveSite,
  reserveStock,
  slotCount,
  takeSlot,
  task,
  tileOf,
} from './tasks'
import type { Building, Citizen, Reservation, Step, Task } from './types'
import { distanceTo, haulOutputTask, outputHeld, outputsOf } from './work'

/**
 * Decides what an idle citizen does next. Order: urgent needs, personal supplies, household provisioning,
 * their job (workplace or builder), general labour, then idling. Banished-style: everyone without a
 * job is a laborer, and workers with nothing to do pitch in as laborers too.
 */
export function chooseTask(sim: Simulation, c: Citizen): Task | null {
  const r = sim.rules.citizen
  if (c.hunger < r.hungerThreshold) {
    const t = eatTask(sim, c)
    if (t) return t
  }
  if (c.warmth < r.warmthThreshold && sim.coldness > 0) {
    const t = warmTask(sim, c)
    if (t) return t
  }
  if (c.sick > 0 && c.home && sim.rng.chance(0.5)) return restTask(sim, c, 15)
  if (c.age < r.adultAge * 12) return childTask(sim, c)

  const supplies = suppliesTask(sim, c)
  if (supplies) return supplies
  const provision = provisionTask(sim, c)
  if (provision) return provision

  let t: Task | null = null
  if (c.workplace) t = workplaceTask(sim, c)
  else if (c.profession === 'builder') t = builderTask(sim, c)
  return t ?? laborTask(sim, c) ?? idleTask(sim, c)
}

// ---------------------------------------------------------------- needs

function eatTask(sim: Simulation, c: Citizen): Task | null {
  const home = c.home ? sim.buildings.get(c.home) : undefined
  if (home && foodIn(sim, home) >= 1) {
    return task('need', 'Eating at home', home.id, [gotoBuilding(home, true), { op: 'work', seconds: 2, effect: 'eat', args: [home.id] }])
  }
  let best: Building | null = null
  let bestD = Infinity
  for (const s of sim.storages()) {
    if (s.fire > 0 || foodIn(sim, s) < 1) continue
    const d = distanceTo(sim, c, s.door)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  if (!best) return null
  return task('need', 'Eating from the stores', best.id, [gotoBuilding(best), { op: 'work', seconds: 1.5, effect: 'eat', args: [best.id] }])
}

/** Where a citizen can get warm: a heated home, else a shelter (the Guildhall). */
function warmPlace(sim: Simulation, c: Citizen): Building | null {
  const home = c.home ? sim.buildings.get(c.home) : undefined
  if (home && (home.data.heated || amount(home.stock, 'firewood') > 0)) return home
  let best: Building | null = null
  let bestD = Infinity
  for (const b of sim.buildings.values()) {
    if (b.site || b.fire > 0 || !sim.def(b).components.shelter) continue
    const d = distanceTo(sim, c, b.door)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best ?? home ?? null
}

function warmTask(sim: Simulation, c: Citizen): Task | null {
  const place = warmPlace(sim, c)
  if (!place) return null
  const rate = sim.rules.citizen.warmUpPerMonth / sim.rules.secondsPerMonth
  const seconds = Math.min(30, (0.95 - c.warmth) / rate + 2)
  return task('need', place.id === c.home ? 'Warming up at home' : 'Sheltering from the cold', place.id, [
    gotoBuilding(place, true),
    { op: 'wait', seconds },
  ])
}

function restTask(sim: Simulation, c: Citizen, seconds: number): Task | null {
  const home = sim.buildings.get(c.home)
  if (!home) return null
  return task('need', c.sick > 0 ? 'Resting with fever' : 'Resting at home', home.id, [gotoBuilding(home, true), { op: 'wait', seconds }])
}

/** Replace worn-out tools, and coats before the cold sets in. */
function suppliesTask(sim: Simulation, c: Citizen): Task | null {
  const wantsCoat = c.coat <= 0 && (sim.coldness > 0 || sim.season.id === 'autumn')
  for (const [res, needed] of [
    ['tools', c.tools <= 0],
    ['coats', wantsCoat],
  ] as const) {
    if (!needed) continue
    const store = nearestStorageWith(sim, res, tileOf(c, sim))
    if (!store) continue
    return task('need', res === 'tools' ? 'Collecting new tools' : 'Collecting a warm coat', store.id, [
      gotoBuilding(store),
      { op: 'take', from: store.id, res, qty: 1 },
      { op: 'do', effect: 'equip' },
    ], [reserveStock(store, res, 1)])
  }
  return null
}

/** One resident at a time stocks the home pantry with a mix of foods, and firewood when it is cold. */
function provisionTask(sim: Simulation, c: Citizen): Task | null {
  const home = c.home ? sim.buildings.get(c.home) : undefined
  if (!home || home.site || slotCount(home, 'provisioning') > 0) return null
  const h = sim.rules.housing
  const carry = sim.rules.citizen.carry
  const near = home.door

  const coldSoon = sim.coldness > 0 || sim.season.id === 'autumn' || sim.rules.temperature[(sim.month + 1) % 12] < sim.rules.citizen.comfortTemperature
  const firewood = amount(home.stock, 'firewood') + amount(home.incoming, 'firewood')
  if (coldSoon && firewood < h.pantryFirewood / 2) {
    const store = nearestStorageWith(sim, 'firewood', near)
    if (store) {
      const qty = Math.min(carry, h.pantryFirewood - firewood, available(store, 'firewood'))
      if (qty >= 1) {
        return task('need', 'Bringing firewood home', home.id, [
          gotoBuilding(store),
          { op: 'take', from: store.id, res: 'firewood', qty },
          gotoBuilding(home, true),
          { op: 'give', to: home.id },
        ], [reserveStock(store, 'firewood', qty), reserveIncoming(home, 'firewood', qty), takeSlot(home, 'provisioning')])
      }
    }
  }

  const target = home.residents.length * sim.rules.citizen.mealSize * h.pantryMeals
  let food = 0
  for (const f of foodIds(sim)) food += amount(home.stock, f) + amount(home.incoming, f)
  if (food >= target / 2) return null
  let best: Building | null = null
  let bestScore = -Infinity
  for (const s of sim.storages()) {
    if (s.fire > 0) continue
    const kinds = foodIds(sim).filter((f) => available(s, f) >= 1).length
    if (kinds === 0) continue
    const score = kinds * 6 - sim.world.distance(s.door, near)
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  if (!best) return null
  // Round-robin over the foods on offer for variety.
  const want = Math.min(carry, Math.ceil(target - food))
  const plan: Record<string, number> = {}
  let planned = 0
  const kinds = foodIds(sim).filter((f) => available(best!, f) >= 1)
  while (planned < want) {
    let added = false
    for (const f of kinds) {
      if (planned >= want) break
      if ((plan[f] ?? 0) + 1 <= available(best, f)) {
        plan[f] = (plan[f] ?? 0) + 1
        planned++
        added = true
      }
    }
    if (!added) break
  }
  if (planned < 1) return null
  const steps: Step[] = [gotoBuilding(best)]
  const res: Reservation[] = [takeSlot(home, 'provisioning')]
  for (const [f, qty] of Object.entries(plan)) {
    steps.push({ op: 'take', from: best.id, res: f, qty })
    res.push(reserveStock(best, f, qty), reserveIncoming(home, f, qty))
  }
  steps.push(gotoBuilding(home, true), { op: 'give', to: home.id })
  return task('need', 'Stocking the pantry', home.id, steps, res)
}

function childTask(sim: Simulation, c: Citizen): Task | null {
  const anchor = c.home ? sim.buildings.get(c.home)?.door : undefined
  const center = anchor ?? tileOf(c, sim)
  const spot = randomNearbyTile(sim, center, 5)
  if (spot < 0 || sim.rng.chance(0.3)) {
    const home = c.home ? sim.buildings.get(c.home) : undefined
    if (home) return task('idle', 'Playing indoors', home.id, [gotoBuilding(home, true), { op: 'wait', seconds: 10 + sim.rng.int(10) }])
    return null
  }
  return task('idle', 'Playing', c.home, [{ op: 'goto', tile: spot }, { op: 'wait', seconds: 3 + sim.rng.int(6) }])
}

function idleTask(sim: Simulation, c: Citizen): Task | null {
  const home = c.home ? sim.buildings.get(c.home) : undefined
  if (home && sim.rng.chance(0.6)) {
    return task('idle', 'Resting at home', home.id, [gotoBuilding(home, true), { op: 'wait', seconds: 8 + sim.rng.int(8) }])
  }
  const hall = [...sim.buildings.values()].find((b) => !b.site && sim.def(b).components.shelter)
  const spot = randomNearbyTile(sim, hall?.door ?? tileOf(c, sim), 6)
  if (spot < 0) return null
  return task('idle', 'Idle', 0, [{ op: 'goto', tile: spot }, { op: 'wait', seconds: 4 + sim.rng.int(6) }])
}

function randomNearbyTile(sim: Simulation, center: number, radius: number): number {
  const world = sim.world
  const cx = world.xOf(center)
  const cy = world.yOf(center)
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = cx + sim.rng.int(radius * 2 + 1) - radius
    const y = cy + sim.rng.int(radius * 2 + 1) - radius
    if (world.inBounds(x, y) && world.walkable(world.index(x, y))) return world.index(x, y)
  }
  return -1
}

// ---------------------------------------------------------------- jobs

function workplaceTask(sim: Simulation, c: Citizen): Task | null {
  const b = sim.buildings.get(c.workplace)
  if (!b || b.site || b.fire > 0) return null
  for (const [handler, cfg] of sim.components(b)) {
    const t = handler.work?.(sim, b, cfg, c)
    if (t) return t
  }
  return haulOutputTask(sim, c, b, 1)
}

/** Builders raise construction sites and lay roads; with nothing to build they labour. */
function builderTask(sim: Simulation, c: Citizen): Task | null {
  const chunk = sim.rules.construction.workChunkSeconds
  let best: Building | null = null
  let bestScore = Infinity
  for (const b of sim.buildings.values()) {
    if (!b.site || b.site.stage !== 'building') continue
    const allowed = totalWork(sim, b) * deliveredFraction(sim, b)
    if (allowed - b.site.work < 0.25) continue
    const slots = Math.max(1, Math.ceil(b.w * b.h * sim.rules.construction.buildersPerTile))
    if (slotCount(b, 'builders') >= slots) continue
    const score = distanceTo(sim, c, b.door) - (b.site.priority ? 10000 : 0)
    if (score < bestScore) {
      bestScore = score
      best = b
    }
  }
  if (best) {
    const def = sim.def(best)
    return task('build', `Building ${def.name}`, best.id, [
      { op: 'goto', tile: best.door },
      { op: 'work', seconds: chunk, effect: 'build', args: [best.id, chunk] },
    ], [takeSlot(best, 'builders')])
  }
  return roadTask(sim, c)
}

function roadTask(sim: Simulation, c: Citizen): Task | null {
  const world = sim.world
  const here = tileOf(c, sim)
  let bestTile = -1
  let bestD = Infinity
  for (const job of sim.roadJobs.values()) {
    if (sim.claimed.has(job.tile) || world.feature[job.tile] !== 0) continue
    const d = world.distance(here, job.tile)
    if (d < bestD) {
      bestD = d
      bestTile = job.tile
    }
  }
  if (bestTile < 0) return null
  const job = sim.roadJobs.get(bestTile)!
  const road = sim.rules.roads.find((r) => r.id === job.road)!
  const steps: Step[] = []
  const res: Reservation[] = [claimTile(sim, bestTile)]
  for (const [item, qty] of Object.entries(road.cost)) {
    const store = nearestStorageWith(sim, item, bestTile, qty)
    if (!store) {
      sim.claimed.delete(bestTile)
      return null
    }
    steps.push(gotoBuilding(store), { op: 'take', from: store.id, res: item, qty })
    res.push(reserveStock(store, item, qty))
  }
  steps.push({ op: 'goto', tile: bestTile }, { op: 'work', seconds: road.work, effect: 'buildRoad', args: [bestTile] })
  return task('build', `Laying ${road.name.toLowerCase()}`, 0, steps, res)
}

/** General labour: supply construction sites, clear marked land, haul goods to storage. */
export function laborTask(sim: Simulation, c: Citizen): Task | null {
  return supplySiteTask(sim, c) ?? clearTask(sim, c) ?? haulAnyTask(sim, c)
}

function supplySiteTask(sim: Simulation, c: Citizen): Task | null {
  const sites: Building[] = []
  for (const b of sim.buildings.values()) if (b.site) sites.push(b)
  if (sites.length === 0) return null
  sites.sort((a, b) => Number(b.site!.priority) - Number(a.site!.priority) || distanceTo(sim, c, a.door) - distanceTo(sim, c, b.door))
  const carry = sim.rules.citizen.carry
  for (const site of sites) {
    const cost = sim.def(site).cost.resources
    for (const res in cost) {
      const need = cost[res] - amount(site.site!.delivered, res) - amount(site.site!.incoming, res)
      if (need <= 0) continue
      const store = nearestStorageWith(sim, res, site.door)
      if (!store) continue
      const qty = Math.min(need, carry, available(store, res))
      if (qty < 1 && qty < need) continue
      return task('labor', `Supplying ${sim.def(site).name}`, site.id, [
        gotoBuilding(store),
        { op: 'take', from: store.id, res, qty },
        { op: 'goto', tile: site.door },
        { op: 'give', to: site.id },
      ], [reserveStock(store, res, qty), reserveSite(site, res, qty)])
    }
  }
  return null
}

function clearTask(sim: Simulation, c: Citizen): Task | null {
  if (sim.clearQueue.size === 0) return null
  const world = sim.world
  const here = tileOf(c, sim)
  let best = -1
  let bestScore = Infinity
  const stale: number[] = []
  for (const tile of sim.clearQueue) {
    if (world.feature[tile] === 0) {
      stale.push(tile)
      continue
    }
    if (sim.claimed.has(tile)) continue
    const site = world.building[tile] ? sim.buildings.get(world.building[tile]) : undefined
    const score = world.distance(here, tile) - (site?.site ? (site.site.priority ? 20000 : 10000) : 0)
    if (score < bestScore) {
      bestScore = score
      best = tile
    }
  }
  for (const tile of stale) sim.clearQueue.delete(tile)
  if (best < 0) return null
  const approach = approachTile(sim, best)
  if (approach < 0) return null
  const def = sim.featureDef(world.feature[best])!
  const steps: Step[] = [{ op: 'goto', tile: approach }, { op: 'work', seconds: def.clear.seconds, effect: 'clearFeature', args: [best] }]
  const res: Reservation[] = [claimTile(sim, best)]
  const store = nearestStorageFor(sim, def.clear.resource, best)
  if (store) {
    steps.push(gotoBuilding(store), { op: 'give', to: store.id })
    res.push(reserveIncoming(store, def.clear.resource, def.clear.amount))
  }
  return task('labor', `Clearing ${def.name.toLowerCase()}`, 0, steps, res)
}

function haulAnyTask(sim: Simulation, c: Citizen): Task | null {
  const min = sim.rules.citizen.carry / 2
  let best: Building | null = null
  let bestScore = Infinity
  for (const b of sim.buildings.values()) {
    if (b.site || b.fire > 0 || sim.def(b).components.storage) continue
    if (outputsOf(sim, b).length === 0 || outputHeld(sim, b) < min) continue
    const score = distanceTo(sim, c, b.door) - outputHeld(sim, b)
    if (score < bestScore) {
      bestScore = score
      best = b
    }
  }
  return best ? haulOutputTask(sim, c, best, min, 'labor') : null
}
