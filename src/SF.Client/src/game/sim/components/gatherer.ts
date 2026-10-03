import { registerEffect } from '../effects'
import { energyBlocked } from '../energy'
import { addStock, nearestStorageFor } from '../inventory'
import type { Simulation } from '../simulation'
import { sootExposure } from '../soot'
import { approachTile, claimTile, gotoBuilding, reserveIncoming, task } from '../tasks'
import { TERRAIN_IDS, type Building, type Citizen, type Stock, type Task } from '../types'
import { haulOutputTask, outputFull } from '../work'
import { registerComponent } from './registry'

export interface GathererConfig {
  /** Feature mode: harvest or fell these features within the radius. */
  features?: string[]
  radius?: number
  replant?: { feature: string; density: number; seconds: number }
  /** On-site mode: produce this yield per work cycle at the building. */
  yield?: Stock
  seconds?: number
  /** On-site yield scales with surrounding features or terrain (hunting grounds, fishing waters). */
  scale?: { by: 'feature' | 'terrain'; id: string; radius: number; full: number }
  /** Share of the yield lost in fully sooty air (game and fish shun the smoke). */
  sootPenalty?: number
}

function centre(b: Building): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2]
}

function computeScale(sim: Simulation, b: Building, cfg: GathererConfig): number {
  const [x, y] = centre(b)
  const smoke = cfg.sootPenalty ? 1 - cfg.sootPenalty * sootExposure(sim, x, y) : 1
  return groundScale(sim, b, cfg) * smoke
}

function groundScale(sim: Simulation, b: Building, cfg: GathererConfig): number {
  const s = cfg.scale
  if (!s) return 1
  const world = sim.world
  const [cx, cy] = centre(b)
  let count = 0
  if (s.by === 'feature') {
    const code = sim.featureCode(s.id)
    world.forRadius(cx, cy, s.radius, (i) => {
      if (world.feature[i] === code) count++
    })
  } else {
    const id = TERRAIN_IDS[s.id]
    world.forRadius(cx, cy, s.radius, (i) => {
      if (world.terrain[i] === id) count++
    })
  }
  return Math.min(1, count / s.full)
}

function yieldResources(sim: Simulation, cfg: GathererConfig): string[] {
  if (cfg.yield) return Object.keys(cfg.yield)
  const out: string[] = []
  for (const id of cfg.features ?? []) {
    const def = sim.content.features.get(id)
    const res = def?.harvest?.resource ?? def?.clear.resource
    if (res && !out.includes(res)) out.push(res)
  }
  return out
}

/** Nearest gatherable feature tile in range: ripe harvestables, or mature trees for felling. */
function findTarget(sim: Simulation, b: Building, cfg: GathererConfig, c: Citizen): number {
  const world = sim.world
  const codes = new Set((cfg.features ?? []).map((id) => sim.featureCode(id)))
  const [cx, cy] = centre(b)
  const px = c.x
  const py = c.y
  let best = -1
  let bestD = Infinity
  world.forRadius(cx, cy, cfg.radius ?? 12, (i) => {
    const code = world.feature[i]
    if (!codes.has(code) || sim.claimed.has(i) || world.building[i] !== 0) return
    const def = sim.featureDef(code)!
    if (def.harvest ? world.growth[i] === 0 : world.growth[i] < 255) return
    if (def.harvest === undefined && sim.atLimit(def.clear.resource)) return
    if (def.harvest && sim.atLimit(def.harvest.resource)) return
    const dx = world.xOf(i) + 0.5 - px
    const dy = world.yOf(i) + 0.5 - py
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

function plantTask(sim: Simulation, b: Building, cfg: GathererConfig): Task | null {
  const replant = cfg.replant
  if (!replant) return null
  const world = sim.world
  const code = sim.featureCode(replant.feature)
  const [cx, cy] = centre(b)
  let trees = 0
  let area = 0
  const empty: number[] = []
  world.forRadius(cx, cy, cfg.radius ?? 12, (i) => {
    if (!world.walkable(i) || world.building[i] !== 0) return
    area++
    if (world.feature[i] === code) trees++
    else if (world.feature[i] === 0 && world.road[i] === 0 && world.door[i] === 0 && world.terrain[i] === TERRAIN_IDS.grass && !sim.claimed.has(i) && !sim.roadJobs.has(i)) empty.push(i)
  })
  if (trees >= area * replant.density || empty.length === 0) return null
  // Plant away from the lodge itself so the clearing around buildings stays open.
  const candidates = empty.filter((i) => world.distance(i, b.door) > 2.5)
  const tile = sim.rng.pick(candidates.length ? candidates : empty)!
  return task('work', 'Planting saplings', b.id, [{ op: 'goto', tile }, { op: 'work', seconds: replant.seconds, effect: 'plantFeature', args: [tile, code], at: b.id }], [claimTile(sim, tile)])
}

registerEffect('gatherOnsite', (sim, _c, [id]) => {
  const b = sim.buildings.get(id)
  if (!b) return false
  const cfg = sim.component<GathererConfig>(b, 'gatherer')
  if (!cfg?.yield) return false
  const scale = (b.data.scale as number | undefined) ?? 1
  for (const [res, qty] of Object.entries(cfg.yield)) {
    addStock(b.stock, res, qty * scale)
    sim.recordProduced(res, qty * scale)
  }
  return true
})

registerComponent<GathererConfig>({
  kind: 'gatherer',
  activate: (sim, b, cfg) => {
    b.data.scale = computeScale(sim, b, cfg)
  },
  month: (sim, b, cfg) => {
    b.data.scale = computeScale(sim, b, cfg)
  },
  outputs: (sim, _b, cfg) => yieldResources(sim, cfg),
  work: (sim, b, cfg, c) => {
    if (outputFull(sim, b) || energyBlocked(sim, b)) return haulOutputTask(sim, c, b, 1)
    const carry = sim.rules.citizen.carry

    if (cfg.yield) {
      if (Object.keys(cfg.yield).every((res) => sim.atLimit(res))) return haulOutputTask(sim, c, b, 1)
      if (((b.data.scale as number) ?? 1) <= 0.02) return null
      // Workers deliver their own output once a load has built up.
      const haul = haulOutputTask(sim, c, b, carry)
      if (haul) return haul
      return task('work', 'Working', b.id, [gotoBuilding(b, true), { op: 'work', seconds: cfg.seconds ?? 20, effect: 'gatherOnsite', args: [b.id], at: b.id }])
    }

    const target = findTarget(sim, b, cfg, c)
    const wantsPlanting = cfg.replant && (target < 0 || sim.rng.chance(0.35))
    if (wantsPlanting) {
      const plant = plantTask(sim, b, cfg)
      if (plant) return plant
    }
    if (target < 0) return haulOutputTask(sim, c, b, 1)
    const def = sim.featureDef(sim.world.feature[target])!
    const yieldDef = def.harvest ?? def.clear
    const store = nearestStorageFor(sim, yieldDef.resource, target)
    if (!store) return null
    const approach = approachTile(sim, target)
    if (approach < 0) return null
    const verb = def.harvest ? 'Gathering' : 'Felling'
    return task('work', `${verb} ${def.name.toLowerCase()}`, b.id, [
      { op: 'goto', tile: approach },
      { op: 'work', seconds: yieldDef.seconds, effect: 'gatherFeature', args: [target], at: b.id },
      gotoBuilding(store),
      { op: 'give', to: store.id },
    ], [claimTile(sim, target), reserveIncoming(store, yieldDef.resource, yieldDef.amount)])
  },
  describe: (_sim, b, cfg) => {
    const lines: string[] = []
    if (cfg.radius) lines.push(`Works within ${cfg.radius} tiles`)
    if (cfg.scale || cfg.sootPenalty) {
      const why = [cfg.scale ? `${cfg.scale.id} nearby` : '', cfg.sootPenalty ? 'smoke drives game away' : ''].filter(Boolean).join('; ')
      lines.push(`Yield ${Math.round(((b.data.scale as number) ?? 1) * 100)}% (${why})`)
    }
    return lines
  },
})
