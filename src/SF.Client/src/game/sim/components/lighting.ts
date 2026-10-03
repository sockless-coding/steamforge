import { energyBlocked } from '../energy'
import type { Simulation } from '../simulation'
import type { Building } from '../types'
import { registerComponent } from './registry'

export interface LightingConfig {
  /** Buildings and sites whose centre lies within this many tiles are lit after dark. */
  radius: number
}

interface Light {
  x: number
  y: number
  r2: number
}

/**
 * Lit sources per simulation, rebuilt at most once per tick. A save always falls between ticks, so a loaded colony
 * rebuilds exactly what the original would have.
 */
const cache = new WeakMap<Simulation, { tick: number; lights: Light[] }>()

function lights(sim: Simulation): Light[] {
  const hit = cache.get(sim)
  if (hit && hit.tick === sim.tick) return hit.lights
  const out: Light[] = []
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<LightingConfig>(b, 'lighting')
    if (cfg && !b.site && b.fire === 0 && !energyBlocked(sim, b)) out.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, r2: cfg.radius * cfg.radius })
  }
  cache.set(sim, { tick: sim.tick, lights: out })
  return out
}

/** Whether lamplight reaches a building or construction site, so work there can go on through the night. */
export function isLit(sim: Simulation, b: Building): boolean {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  for (const l of lights(sim)) {
    const dx = l.x - cx
    const dy = l.y - cy
    if (dx * dx + dy * dy <= l.r2) return true
  }
  return false
}

registerComponent<LightingConfig>({
  kind: 'lighting',
  describe: (sim, b, cfg) => [`Lights workplaces and sites within ${cfg.radius} tiles for night work${energyBlocked(sim, b) ? ' (needs energy)' : ''}`],
})
