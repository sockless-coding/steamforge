import type { BuildingDef } from '../../api/types'
import { addStock, addToStorage } from './inventory'
import { fireWorker } from './population'
import { lockedBy } from './research'
import { checkDispatches } from './story'
import type { Simulation } from './simulation'
import { TERRAIN_IDS, type ActionResult, type Building, type Rotation } from './types'
import { MARK_CLEAR, type World } from './world'

const MAX_SLOPE = 1.8
const MAX_FIELD_SLOPE = 3

const fail = (reason: string): ActionResult => ({ ok: false, reason })

/** Footprint in world tiles. Variable-size buildings (fields) take the dragged size and ignore rotation. */
export function footprintSize(def: BuildingDef, rot: Rotation, w?: number, h?: number): [number, number] {
  const variable = def.placement?.variableSize
  if (variable && w && h) {
    return [
      Math.max(variable.min[0], Math.min(variable.max[0], Math.round(w))),
      Math.max(variable.min[1], Math.min(variable.max[1], Math.round(h))),
    ]
  }
  const [dw, dh] = def.size
  return rot % 2 === 1 ? [dh, dw] : [dw, dh]
}

/** The tile in front of the building's door side (rot 0 faces +y), or the centre for walkable buildings. */
export function doorTile(world: World, def: BuildingDef, x: number, y: number, w: number, h: number, rot: Rotation): number {
  if (def.walkable) return world.index(x + (w >> 1), y + (h >> 1))
  switch (rot) {
    case 0:
      return world.index(x + (w >> 1), y + h)
    case 1:
      return world.index(x + w, y + ((h - 1) >> 1))
    case 2:
      return world.index(x + ((w - 1) >> 1), y - 1)
    default:
      return world.index(x - 1, y + (h >> 1))
  }
}

export function countBuildings(sim: Simulation, defId: string): number {
  let n = 0
  for (const b of sim.buildings.values()) if (b.def === defId) n++
  return n
}

export function canPlace(sim: Simulation, def: BuildingDef, x: number, y: number, rot: Rotation, w?: number, h?: number, ignoreResearch = false): ActionResult {
  if (def.buildable === false) return fail(`${def.name} cannot be built.`)
  const lock = ignoreResearch ? null : lockedBy(sim, 'building', def.id)
  if (lock) return fail(`Requires research: ${lock.name}.`)
  if (def.limit && countBuildings(sim, def.id) >= def.limit) return fail(`Only ${def.limit} ${def.name} allowed.`)
  const world = sim.world
  const [fw, fh] = footprintSize(def, rot, w, h)
  if (x < 1 || y < 1 || x + fw > world.width - 1 || y + fh > world.height - 1) return fail('Too close to the edge of the map.')

  const terrainRule = def.placement?.terrain
  const terrainId = terrainRule ? TERRAIN_IDS[terrainRule.id] : -1
  let terrainCount = 0
  let lo = Infinity
  let hi = -Infinity
  for (let ty = y; ty < y + fh; ty++) {
    for (let tx = x; tx < x + fw; tx++) {
      const i = world.index(tx, ty)
      if (!world.isLand(i)) return fail(world.terrain[i] === TERRAIN_IDS.water ? 'Cannot build on water.' : 'Cannot build on a mountainside.')
      if (world.building[i] !== 0) return fail('Something is already built here.')
      if (world.door[i] !== 0) return fail("That would block a building's entrance.")
      if (world.terrain[i] === terrainId) terrainCount++
      lo = Math.min(lo, world.elevation[i])
      hi = Math.max(hi, world.elevation[i])
    }
  }
  if (hi - lo > (def.walkable ? MAX_FIELD_SLOPE : MAX_SLOPE)) return fail('The ground is too steep.')
  if (terrainRule && terrainCount < terrainRule.min) {
    return fail(`Must be placed over ${terrainRule.id} (${terrainCount}/${terrainRule.min} tiles).`)
  }

  const adjacent = def.placement?.adjacent
  if (adjacent) {
    const id = TERRAIN_IDS[adjacent.id]
    let count = 0
    for (let ty = y - 1; ty <= y + fh; ty++) {
      for (let tx = x - 1; tx <= x + fw; tx++) {
        const edge = tx === x - 1 || ty === y - 1 || tx === x + fw || ty === y + fh
        if (edge && world.inBounds(tx, ty) && world.terrain[world.index(tx, ty)] === id) count++
      }
    }
    if (count < adjacent.min) return fail(`Must be built beside ${adjacent.id}.`)
  }

  if (!def.walkable) {
    const door = doorTile(world, def, x, y, fw, fh, rot)
    const dx = world.xOf(door)
    const dy = world.yOf(door)
    if (!world.inBounds(dx, dy) || !world.isLand(door) || world.building[door] !== 0) return fail('The entrance would be blocked.')
  }
  return { ok: true }
}

/** Marks the building's tiles and door on the world grid. */
export function occupy(sim: Simulation, b: Building): void {
  const world = sim.world
  const walkable = !!sim.def(b).walkable
  for (let ty = b.y; ty < b.y + b.h; ty++) {
    for (let tx = b.x; tx < b.x + b.w; tx++) {
      const i = world.index(tx, ty)
      world.building[i] = b.id
      world.solid[i] = walkable ? 0 : 1
    }
  }
  if (!walkable) world.door[b.door]++
  world.version++
}

function unoccupy(sim: Simulation, b: Building): void {
  const world = sim.world
  for (let ty = b.y; ty < b.y + b.h; ty++) {
    for (let tx = b.x; tx < b.x + b.w; tx++) {
      const i = world.index(tx, ty)
      if (world.building[i] === b.id) {
        world.building[i] = 0
        world.solid[i] = 0
      }
    }
  }
  if (!sim.def(b).walkable && world.door[b.door] > 0) world.door[b.door]--
  world.version++
}

export function placeBuilding(sim: Simulation, def: BuildingDef, x: number, y: number, rot: Rotation, w: number, h: number, prebuilt: boolean): Building {
  const world = sim.world
  let sum = 0
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) sum += world.elevation[world.index(tx, ty)]
  const base = sum / (w * h)

  const b: Building = {
    id: sim.nextId++,
    def: def.id,
    x,
    y,
    w,
    h,
    rot,
    door: doorTile(world, def, x, y, w, h, rot),
    baseHeight: base,
    site: prebuilt ? null : { stage: 'building', delivered: {}, incoming: {}, work: 0, priority: false },
    stock: {},
    reserved: {},
    incoming: {},
    workers: [],
    workerTarget: 0,
    residents: [],
    data: {},
    fire: 0,
    activeAt: -1,
  }

  let hasFeatures = false
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = world.index(tx, ty)
      if (!def.walkable) world.elevation[i] = base
      if (world.road[i] !== 0) {
        world.road[i] = 0
        sim.emit({ type: 'road', tile: i })
      }
      sim.roadJobs.delete(i)
      if (world.conduit[i] !== 0) {
        world.conduit[i] = 0
        sim.energy.dirty = true
        sim.emit({ type: 'conduit', tile: i })
      }
      for (let n = 0; n < sim.rules.networks.length; n++) {
        if (sim.conduitJobs.delete(i * 8 + n)) sim.emit({ type: 'conduit', tile: i })
      }
      if (world.feature[i] !== 0) {
        if (prebuilt) {
          world.feature[i] = 0
          world.growth[i] = 0
          world.mark[i] &= ~MARK_CLEAR
          sim.clearQueue.delete(i)
          sim.emit({ type: 'feature', tile: i })
        } else {
          sim.queueClear(i)
          hasFeatures = true
        }
      }
    }
  }
  if (!def.walkable) sim.emit({ type: 'terrain', x, y, w, h })
  if (b.site && hasFeatures) b.site.stage = 'clearing'

  sim.buildings.set(b.id, b)
  occupy(sim, b)
  sim.emit({ type: 'building', id: b.id, change: 'added' })
  if (prebuilt) activateBuilding(sim, b)
  return b
}

/** Finishes construction: the building starts working. */
export function activateBuilding(sim: Simulation, b: Building): void {
  b.site = null
  b.workerTarget = sim.maxWorkers(b)
  for (const [handler, cfg] of sim.components(b)) handler.activate?.(sim, b, cfg)
  sim.invalidateStorages()
  sim.housingDirty = true
  sim.jobsDirty = true
  sim.energy.dirty = true
  sim.emit({ type: 'building', id: b.id, change: 'completed' })
  if (sim.tick > 0) checkDispatches(sim, { building: b.def })
}

/** Total worker-seconds needed; variable-size buildings scale with area. */
export function totalWork(sim: Simulation, b: Building): number {
  const def = sim.def(b)
  if (!def.placement?.variableSize) return def.cost.work
  return Math.max(4, (def.cost.work * b.w * b.h) / (def.size[0] * def.size[1]))
}

/** Fraction of the material cost already delivered to a site (1 when it costs nothing). */
export function deliveredFraction(sim: Simulation, b: Building): number {
  if (!b.site) return 1
  const cost = sim.def(b).cost.resources
  let need = 0
  let have = 0
  for (const res in cost) {
    need += cost[res]
    have += Math.min(cost[res], b.site.delivered[res] ?? 0)
  }
  return need === 0 ? 1 : have / need
}

export function removeBuilding(sim: Simulation, b: Building): void {
  for (const [handler, cfg] of sim.components(b)) handler.remove?.(sim, b, cfg)
  for (const id of [...b.workers]) fireWorker(sim, id)
  for (const id of b.residents) {
    const c = sim.citizens.get(id)
    if (c) c.home = 0
  }
  b.residents = []
  for (const c of sim.citizens.values()) {
    if (c.inside === b.id) c.inside = 0
  }
  unoccupy(sim, b)
  sim.buildings.delete(b.id)
  sim.invalidateStorages()
  sim.housingDirty = true
  sim.jobsDirty = true
  sim.energy.dirty = true
  sim.emit({ type: 'building', id: b.id, change: 'removed' })
}

/** Returns materials to storage: everything delivered for a site, or a fraction of the cost for a finished building. */
export function refund(sim: Simulation, b: Building, fraction: number): void {
  const source = b.site ? b.site.delivered : sim.def(b).cost.resources
  for (const res in source) {
    const qty = Math.floor(source[res] * fraction)
    if (qty > 0) addToStorage(sim, res, qty, b.door, b.id)
  }
}

function hasMargin(sim: Simulation, x: number, y: number, w: number, h: number): boolean {
  const world = sim.world
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      if (!world.inBounds(tx, ty)) return false
      const i = world.index(tx, ty)
      if (world.building[i] !== 0 || world.road[i] !== 0) return false
    }
  }
  return true
}

/** Deterministic spiral search for a free spot near (cx, cy), keeping a one-tile gap around the footprint. */
export function findSpot(sim: Simulation, def: BuildingDef, cx: number, cy: number, maxRadius = 30, ignoreResearch = false): { x: number; y: number } | null {
  const [w, h] = footprintSize(def, 0)
  for (let r = 2; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx - (w >> 1)
        const y = cy + dy - (h >> 1)
        if (!canPlace(sim, def, x, y, 0, undefined, undefined, ignoreResearch).ok || !hasMargin(sim, x, y, w, h)) continue
        const door = doorTile(sim.world, def, x, y, w, h, 0)
        if (!sim.world.walkable(door)) continue
        return { x, y }
      }
    }
  }
  return null
}

/** The Steamforge (headquarters), a short plaza road, the difficulty's starting buildings and its supplies. */
export function placeStartingBuildings(sim: Simulation, sx: number, sy: number): void {
  const world = sim.world
  const hq = sim.content.headquarters
  const forge = placeBuilding(sim, hq, sx - (hq.size[0] >> 1), sy + 1 - hq.size[1], 0, hq.size[0], hq.size[1], true)

  const dirt = sim.rules.roads.findIndex((r) => r.id === 'dirt') + 1
  if (dirt > 0) {
    for (let dx = -7; dx <= 7; dx++) {
      const i = world.index(sx + dx, sy + 1)
      if (world.walkable(i) && world.building[i] === 0) world.road[i] = dirt
    }
  }

  for (const entry of sim.preset.startingBuildings) {
    const def = sim.content.buildings.get(entry.id)
    if (!def) continue
    for (let n = 0; n < entry.count; n++) {
      const spot = findSpot(sim, def, sx, sy + 3, 30, true)
      if (spot) placeBuilding(sim, def, spot.x, spot.y, 0, ...footprintSize(def, 0), true)
    }
  }

  for (const [res, qty] of Object.entries(sim.preset.startingResources)) {
    const left = addToStorage(sim, res, qty, forge.door)
    if (left > 0) addStock(forge.stock, res, left)
  }
}
