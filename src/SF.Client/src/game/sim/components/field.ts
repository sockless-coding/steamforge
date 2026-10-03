import type { CropDef } from '../../../api/types'
import { registerEffect } from '../effects'
import { addStock } from '../inventory'
import type { Simulation } from '../simulation'
import { grimeLevel } from '../soot'
import { claimTile, task } from '../tasks'
import type { Building } from '../types'
import { haulOutputTask, outputFull } from '../work'
import { registerComponent } from './registry'

export interface FieldConfig {
  crops: string[]
  tilesPerWorker: number
  plantSeconds: number
  harvestSeconds: number
}

export type FieldPhase = 'fallow' | 'plant' | 'grow' | 'harvest'

/** Steam tractor sheds: fields within reach are planted and harvested faster while the shed has steam. */
export interface TractorConfig {
  radius: number
  /** Extra planting and harvesting speed at full supply. */
  bonus: number
}

/** The best tractor bonus reaching a field (a shed's bonus times its energy supply). */
function tractorBonus(sim: Simulation, b: Building): number {
  let best = 0
  for (const t of sim.buildings.values()) {
    const cfg = sim.component<TractorConfig>(t, 'tractor')
    if (!cfg || t.site || t.fire > 0) continue
    // Distance from the shed to the nearest point of the field.
    const dx = Math.max(b.x - (t.x + t.w / 2), 0, t.x + t.w / 2 - (b.x + b.w))
    const dy = Math.max(b.y - (t.y + t.h / 2), 0, t.y + t.h / 2 - (b.y + b.h))
    if (dx * dx + dy * dy > cfg.radius * cfg.radius) continue
    const power = sim.def(t).components.consumer ? ((t.data.power as number | undefined) ?? 0) : 1
    best = Math.max(best, cfg.bonus * power)
  }
  return best
}

registerComponent<TractorConfig>({
  kind: 'tractor',
  describe: (_sim, b, cfg) => {
    const power = (b.data.power as number | undefined) ?? 0
    return [power > 0.01 ? `Fields within ${cfg.radius} tiles planted and harvested ${Math.round(cfg.bonus * power * 100)}% faster` : 'Idle: the tractors need steam']
  },
})

export function fieldCrop(sim: Simulation, b: Building): CropDef {
  const cfg = sim.component<FieldConfig>(b, 'field')!
  return sim.content.crops.get(b.data.crop as string) ?? sim.content.crops.get(cfg.crops[0])!
}

function plots(b: Building): number[] {
  return b.data.plots as number[]
}

function plotTile(sim: Simulation, b: Building, k: number): number {
  return sim.world.index(b.x + (k % b.w), b.y + Math.floor(k / b.w))
}

registerEffect('plantPlot', (sim, _c, [id, k]) => {
  const b = sim.buildings.get(id)
  if (!b || b.data.phase !== 'plant') return true
  plots(b)[k] = 1
  if (plots(b).every((p) => p === 1)) b.data.phase = 'grow'
  sim.emit({ type: 'building', id: b.id, change: 'changed' })
  return true
})

registerEffect('harvestPlot', (sim, _c, [id, k]) => {
  const b = sim.buildings.get(id)
  if (!b || b.data.phase !== 'harvest' || plots(b)[k] !== 1) return true
  plots(b)[k] = 0
  const crop = fieldCrop(sim, b)
  // Soot-fouled ground yields less.
  const tile = plotTile(sim, b, k)
  const qty = crop.yieldPerTile * (1 - sim.rules.soot.cropPenalty * grimeLevel(sim, sim.world.xOf(tile) + 0.5, sim.world.yOf(tile) + 0.5))
  addStock(b.stock, crop.resource, qty)
  sim.recordProduced(crop.resource, qty)
  if (plots(b).every((p) => p === 0)) {
    b.data.phase = 'fallow'
    b.data.growth = 0
  }
  sim.emit({ type: 'building', id: b.id, change: 'changed' })
  return true
})

/**
 * Crop fields: farmers plant every plot in spring, the crop grows through the warm months, and it must be harvested
 * before winter or the frost takes it.
 */
registerComponent<FieldConfig>({
  kind: 'field',
  activate: (sim, b, cfg) => {
    b.data.crop ??= cfg.crops[0]
    b.data.plots = new Array(b.w * b.h).fill(0)
    b.data.growth = 0
    b.data.phase = sim.season.id === 'spring' ? 'plant' : 'fallow'
  },
  workers: (_sim, b, cfg) => Math.max(1, Math.ceil((b.w * b.h) / cfg.tilesPerWorker)),
  /** `data.tractor` holds the steam tractor bonus, read by workSpeed. */
  second: (sim, b) => {
    const bonus = tractorBonus(sim, b)
    if (bonus > 0) b.data.tractor = bonus
    else delete b.data.tractor
  },
  outputs: (sim, b) => [fieldCrop(sim, b).resource],
  month: (sim, b) => {
    const season = sim.season
    const phase = b.data.phase as FieldPhase
    const planted = plots(b).some((p) => p === 1)
    if (!season.growing) {
      if (planted) {
        sim.notify('warn', `Frost destroyed the unharvested ${fieldCrop(sim, b).name.toLowerCase()}.`, b.door)
        b.data.plots = plots(b).map(() => 0)
      }
      b.data.phase = 'fallow'
      b.data.growth = 0
    } else {
      if (phase === 'fallow' && season.id === 'spring') b.data.phase = 'plant'
      if ((phase === 'plant' || phase === 'grow') && planted) {
        const growth = (b.data.growth as number) + 1 / fieldCrop(sim, b).growthMonths
        b.data.growth = Math.min(1, growth)
        if (growth >= 1) b.data.phase = 'harvest'
      }
    }
    sim.emit({ type: 'building', id: b.id, change: 'changed' })
  },
  work: (sim, b, cfg, c) => {
    if (outputFull(sim, b)) return haulOutputTask(sim, c, b, 1)
    const phase = b.data.phase as FieldPhase
    const want = phase === 'plant' ? 0 : phase === 'harvest' ? 1 : -1
    if (want >= 0) {
      // The nearest unclaimed plot in the right state.
      let best = -1
      let bestD = Infinity
      const p = plots(b)
      for (let k = 0; k < p.length; k++) {
        if (p[k] !== want) continue
        const tile = plotTile(sim, b, k)
        if (sim.claimed.has(tile)) continue
        const dx = sim.world.xOf(tile) + 0.5 - c.x
        const dy = sim.world.yOf(tile) + 0.5 - c.y
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
      if (best >= 0) {
        const tile = plotTile(sim, b, best)
        const planting = phase === 'plant'
        return task('work', planting ? 'Planting' : 'Harvesting', b.id, [
          { op: 'goto', tile },
          { op: 'work', seconds: planting ? cfg.plantSeconds : cfg.harvestSeconds, effect: planting ? 'plantPlot' : 'harvestPlot', args: [b.id, best], at: b.id },
        ], [claimTile(sim, tile)])
      }
    }
    return haulOutputTask(sim, c, b, phase === 'harvest' ? sim.rules.citizen.carry : 1)
  },
  option: (sim, b, cfg, key, value) => {
    if (key !== 'crop' || !cfg.crops.includes(value) || !sim.content.crops.has(value)) return false
    if (b.data.phase !== 'fallow' && b.data.phase !== 'plant') return false
    if (b.data.phase === 'plant' && plots(b).some((p) => p === 1)) return false
    b.data.crop = value
    return true
  },
  describe: (sim, b) => {
    const crop = fieldCrop(sim, b)
    const phase = b.data.phase as FieldPhase
    const label = { fallow: 'Fallow until spring', plant: 'Planting', grow: 'Growing', harvest: 'Ready to harvest' }[phase]
    const lines = [`${crop.name}: ${label}`, `Growth ${Math.round(((b.data.growth as number) ?? 0) * 100)}%`]
    const grime = grimeLevel(sim, b.x + b.w / 2, b.y + b.h / 2) * sim.rules.soot.cropPenalty
    if (grime >= 0.01) lines.push(`Soot on the soil: -${Math.round(grime * 100)}% yield`)
    const tractor = (b.data.tractor as number | undefined) ?? 0
    if (tractor > 0) lines.push(`Steam tractors: +${Math.round(tractor * 100)}% planting and harvesting speed`)
    return lines
  },
})
