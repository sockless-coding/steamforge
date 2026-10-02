import { amount } from '../inventory'
import type { Simulation } from '../simulation'
import { gotoBuilding, task } from '../tasks'
import type { Building } from '../types'
import { fetchIntoTask, onHand } from '../work'
import { registerComponent } from './registry'

export interface BoilerConfig {
  fuel: string
  perMonth: number
  capacity: number
  radius: number
  /** Work speed bonus for workplaces in range. */
  workBonus: number
  /** Fraction of firewood saved by homes in range. */
  heatBonus: number
}

export function boilerLit(b: Building): boolean {
  return !b.site && b.fire === 0 && b.data.lit === true
}

/**
 * Recomputes steam coverage: buildings whose centre lies within a lit boiler's radius get `data.steam` (work bonus)
 * and `data.heat` (heating saving). Called every second by the steam system and on load.
 */
export function updateSteam(sim: Simulation): void {
  const boilers: [Building, BoilerConfig][] = []
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<BoilerConfig>(b, 'boiler')
    if (cfg && boilerLit(b)) boilers.push([b, cfg])
  }
  for (const b of sim.buildings.values()) {
    let steam = 0
    let heat = 0
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    for (const [boiler, cfg] of boilers) {
      const dx = boiler.x + boiler.w / 2 - cx
      const dy = boiler.y + boiler.h / 2 - cy
      if (dx * dx + dy * dy <= cfg.radius * cfg.radius) {
        steam = Math.max(steam, cfg.workBonus)
        heat = Math.max(heat, cfg.heatBonus)
      }
    }
    if (steam > 0) b.data.steam = steam
    else delete b.data.steam
    if (heat > 0) b.data.heat = heat
    else delete b.data.heat
  }
}

registerComponent<BoilerConfig>({
  kind: 'boiler',
  second: (sim, b, cfg) => {
    const fuel = amount(b.stock, cfg.fuel)
    const burn = cfg.perMonth / sim.rules.secondsPerMonth
    // Needs a stoker on shift to stay lit.
    const stoked = b.workers.length > 0
    b.data.lit = stoked && fuel >= burn
    if (b.data.lit) {
      b.stock[cfg.fuel] = fuel - burn
      b.activeAt = sim.second
    }
  },
  work: (sim, b, cfg, c) => {
    const want = cfg.capacity - onHand(b, cfg.fuel)
    if (want >= cfg.capacity * 0.4) {
      const fetch = fetchIntoTask(sim, c, b, cfg.fuel, want)
      if (fetch) return fetch
    }
    return task('work', 'Stoking the boiler', b.id, [gotoBuilding(b, true), { op: 'work', seconds: 12, effect: 'none', at: b.id }])
  },
  describe: (sim, b, cfg) => [
    b.data.lit ? `Steam up: +${Math.round(cfg.workBonus * 100)}% work, -${Math.round(cfg.heatBonus * 100)}% firewood within ${cfg.radius} tiles` : 'Cold: needs a stoker and coal',
    `${sim.resource(cfg.fuel)?.name ?? cfg.fuel}: ${Math.floor(amount(b.stock, cfg.fuel))} / ${cfg.capacity}`,
  ],
})
