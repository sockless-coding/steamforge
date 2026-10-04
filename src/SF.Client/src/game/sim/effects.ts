import { conduitGrades, gradeIndex } from './energy'
import { addStock, amount, available, foodIds } from './inventory'
import { activateBuilding, deliveredFraction, roadBlocked, totalWork } from './placement'
import type { Simulation } from './simulation'
import type { Citizen } from './types'
import { MARK_CLEAR } from './world'

/**
 * Named effects run when a task step completes. Steps reference effects by name with numeric arguments so tasks
 * stay plain serializable data. Return false to abort the task. Components register their own effects.
 */
export type Effect = (sim: Simulation, c: Citizen, args: number[]) => boolean

const effects = new Map<string, Effect>()

export function registerEffect(name: string, effect: Effect): void {
  effects.set(name, effect)
}

export function runEffect(name: string, sim: Simulation, c: Citizen, args: number[]): boolean {
  const effect = effects.get(name)
  if (!effect) throw new Error(`Unknown effect '${name}'.`)
  return effect(sim, c, args)
}

function carry(sim: Simulation, c: Citizen, res: string, qty: number): void {
  if (qty <= 0) return
  sim.recordProduced(res, qty)
  c.carry ??= {}
  addStock(c.carry, res, qty)
}

registerEffect('none', () => true)

/** Removes a feature (tree, rock, bush) and carries its yield. */
registerEffect('clearFeature', (sim, c, [tile]) => {
  const world = sim.world
  const def = sim.featureDef(world.feature[tile])
  if (def) {
    // Felling a sapling yields little.
    const scale = def.growth ? Math.max(0.25, world.growth[tile] / 255) : 1
    carry(sim, c, def.clear.resource, Math.max(1, Math.round(def.clear.amount * scale)))
  }
  world.feature[tile] = 0
  world.growth[tile] = 0
  world.mark[tile] &= ~MARK_CLEAR
  sim.clearQueue.delete(tile)
  sim.emit({ type: 'feature', tile })
  return true
})

/** Gathers from a feature: harvests ripe bushes (they regrow) or fells mature trees. */
registerEffect('gatherFeature', (sim, c, [tile]) => {
  const world = sim.world
  const def = sim.featureDef(world.feature[tile])
  if (!def) return true
  if (def.harvest) {
    if (world.growth[tile] > 0) {
      carry(sim, c, def.harvest.resource, def.harvest.amount)
      world.growth[tile] = 0
      sim.emit({ type: 'feature', tile })
    }
    return true
  }
  return runEffect('clearFeature', sim, c, [tile])
})

registerEffect('plantFeature', (sim, _c, [tile, code]) => {
  const world = sim.world
  if (world.feature[tile] !== 0 || world.building[tile] !== 0 || world.road[tile] !== 0) return true
  world.feature[tile] = code
  world.growth[tile] = 8
  sim.emit({ type: 'feature', tile })
  return true
})

/** Adds a chunk of construction work, completing the building when done. */
registerEffect('build', (sim, _c, [id, seconds]) => {
  const b = sim.buildings.get(id)
  if (!b?.site) return true
  const total = totalWork(sim, b)
  const allowed = total * deliveredFraction(sim, b)
  b.site.work = Math.min(allowed, b.site.work + seconds)
  if (b.site.stage === 'building' && b.site.work >= total - 1e-6 && deliveredFraction(sim, b) >= 1) activateBuilding(sim, b)
  else sim.emit({ type: 'building', id: b.id, change: 'changed' })
  return true
})

registerEffect('buildRoad', (sim, c, [tile]) => {
  const job = sim.roadJobs.get(tile)
  if (!job) return true
  const roadIndex = sim.rules.roads.findIndex((r) => r.id === job.road)
  const road = sim.rules.roads[roadIndex]
  for (const res in road.cost) {
    if (!c.carry || amount(c.carry, res) < road.cost[res]) return false
  }
  for (const res in road.cost) addStock(c.carry!, res, -road.cost[res])
  if (c.carry && Object.keys(c.carry).length === 0) c.carry = null
  const world = sim.world
  if (roadBlocked(world, road, tile)) {
    sim.roadJobs.delete(tile)
    return true
  }
  world.road[tile] = roadIndex + 1
  world.version++
  sim.roadJobs.delete(tile)
  sim.emit({ type: 'road', tile })
  return true
})

/** Lays a conduit tile (args: tile, network index), spending the materials the citizen carries. */
registerEffect('buildConduit', (sim, c, [tile, n]) => {
  const key = tile * 8 + n
  const job = sim.conduitJobs.get(key)
  const net = sim.rules.networks[n]
  if (!job || !net) return true
  const at = gradeIndex(sim, job.network, job.grade)
  if (!at) {
    sim.conduitJobs.delete(key)
    return true
  }
  const cost = conduitGrades(net)[at.g].cost
  for (const res in cost) {
    if (!c.carry || amount(c.carry, res) < cost[res]) return false
  }
  for (const res in cost) addStock(c.carry!, res, -cost[res])
  if (c.carry && Object.keys(c.carry).length === 0) c.carry = null
  sim.conduitJobs.delete(key)
  const world = sim.world
  if (world.isLand(tile) && world.building[tile] === 0) {
    world.conduit[tile] |= 1 << n
    world.setGrade(n, tile, at.g)
    sim.energy.dirty = true
  }
  sim.emit({ type: 'conduit', tile })
  return true
})

/** Eats a meal from a home pantry or a storage, favouring foods not eaten recently. */
registerEffect('eat', (sim, c, [id]) => {
  const b = sim.buildings.get(id)
  if (!b) return false
  const r = sim.rules.citizen
  const meal = c.age < r.adultAge * 12 ? r.childMealSize : r.mealSize
  const foods = foodIds(sim)
    .filter((f) => available(b, f) > 0)
    .sort((a, z) => Number(c.diet.includes(a)) - Number(c.diet.includes(z)) || available(b, z) - available(b, a))
  let eaten = 0
  for (const f of foods) {
    if (eaten >= meal) break
    const bite = Math.min(available(b, f), meal - eaten, Math.max(1, meal / 2))
    addStock(b.stock, f, -bite)
    sim.recordConsumed(f, bite)
    eaten += bite
    c.diet = [...c.diet.filter((d) => d !== f), f].slice(-6)
  }
  if (eaten <= 0) return false
  c.hunger = Math.min(1, c.hunger + eaten / meal)
  return true
})

/** An automaton winds its mainspring with the coal it carries. */
registerEffect('wind', (sim, c) => {
  const a = sim.rules.automaton
  if (!c.carry || amount(c.carry, a.windCoal) < a.windAmount - 1e-6) return false
  addStock(c.carry, a.windCoal, -a.windAmount)
  sim.recordConsumed(a.windCoal, a.windAmount)
  if (Object.keys(c.carry).length === 0) c.carry = null
  c.wind = a.windMonths
  return true
})

/** Takes a carried tool or coat into use. */
registerEffect('equip', (sim, c) => {
  const r = sim.rules.citizen
  if (!c.carry) return false
  if (amount(c.carry, 'tools') >= 1) {
    addStock(c.carry, 'tools', -1)
    c.tools = r.toolLifeMonths
  }
  if (amount(c.carry, 'coats') >= 1) {
    addStock(c.carry, 'coats', -1)
    c.coat = r.coatLifeMonths
  }
  if (Object.keys(c.carry).length === 0) c.carry = null
  return true
})
