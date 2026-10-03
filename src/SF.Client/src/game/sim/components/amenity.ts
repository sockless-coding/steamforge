import { energyBlocked } from '../energy'
import type { Simulation } from '../simulation'
import type { Building } from '../types'
import { registerComponent } from './registry'

export interface AmenityConfig {
  /** Homes whose centre lies within this many tiles benefit. */
  radius: number
  /** Added to residents' happiness target. */
  happiness: number
}

/** Most happiness a home can draw from amenities, however many surround it. */
export const MAX_AMENITY = 0.25

/**
 * Amenity bonus per home (gas lamps, the clock tower). Computed from current state each time it is needed rather
 * than cached, so a loaded colony continues exactly as the original. Amenities that need energy only count with it.
 */
export function amenityByHome(sim: Simulation): Map<number, number> {
  const sources: [Building, AmenityConfig][] = []
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<AmenityConfig>(b, 'amenity')
    if (cfg && !b.site && b.fire === 0 && !energyBlocked(sim, b)) sources.push([b, cfg])
  }
  const out = new Map<number, number>()
  if (sources.length === 0) return out
  for (const home of sim.buildings.values()) {
    if (home.site || !sim.def(home).components.housing) continue
    const cx = home.x + home.w / 2
    const cy = home.y + home.h / 2
    let bonus = 0
    for (const [b, cfg] of sources) {
      const dx = b.x + b.w / 2 - cx
      const dy = b.y + b.h / 2 - cy
      if (dx * dx + dy * dy <= cfg.radius * cfg.radius) bonus += cfg.happiness
    }
    if (bonus > 0) out.set(home.id, Math.min(MAX_AMENITY, bonus))
  }
  return out
}

registerComponent<AmenityConfig>({
  kind: 'amenity',
  describe: (sim, b, cfg) => [
    `+${Math.round(cfg.happiness * 100)}% happiness for homes within ${cfg.radius} tiles${energyBlocked(sim, b) ? ' (needs energy)' : ''}`,
  ],
})
