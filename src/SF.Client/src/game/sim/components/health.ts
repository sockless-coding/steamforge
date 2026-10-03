import { takeFromStorage } from '../inventory'
import type { Simulation } from '../simulation'
import type { Building } from '../types'
import { registerComponent } from './registry'

export interface ClinicConfig {
  /** Homes whose centre lies within this many tiles are looked after. */
  radius: number
  /** Share of lung damage prevented for residents of a dosed home. */
  protection: number
  /** Remedy drawn from storage each month for every home in reach. */
  resource: string
  perHome: number
}

function homesInReach(sim: Simulation, b: Building, cfg: ClinicConfig): Building[] {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const homes: Building[] = []
  for (const h of sim.buildings.values()) {
    if (h.site || !sim.def(h).components.housing || h.residents.length === 0) continue
    const dx = h.x + h.w / 2 - cx
    const dy = h.y + h.h / 2 - cy
    if (dx * dx + dy * dy <= cfg.radius * cfg.radius) homes.push(h)
  }
  return homes
}

/** Draws the month's remedies from storage; `data.dosed` is the share of homes in reach that could be supplied. */
function dose(sim: Simulation, b: Building, cfg: ClinicConfig): void {
  const want = homesInReach(sim, b, cfg).length * cfg.perHome
  if (want <= 0 || b.fire > 0) {
    b.data.dosed = 0
    return
  }
  b.data.dosed = takeFromStorage(sim, cfg.resource, want) / want
}

/** Lung protection per home from apothecaries (the best one in reach counts). Computed from current state. */
export function clinicByHome(sim: Simulation): Map<number, number> {
  const out = new Map<number, number>()
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<ClinicConfig>(b, 'clinic')
    const dosed = (b.data.dosed as number | undefined) ?? 0
    if (!cfg || b.site || b.fire > 0 || dosed <= 0) continue
    const protection = cfg.protection * dosed
    for (const h of homesInReach(sim, b, cfg)) out.set(h.id, Math.max(out.get(h.id) ?? 0, protection))
  }
  return out
}

/** Apothecaries hand out remedies that ease soot-damaged lungs in the homes around them. */
registerComponent<ClinicConfig>({
  kind: 'clinic',
  activate: dose,
  month: dose,
  describe: (sim, b, cfg) => {
    const name = sim.resource(cfg.resource)?.name.toLowerCase() ?? cfg.resource
    const dosed = (b.data.dosed as number | undefined) ?? 0
    return [
      `Eases soot damage by ${Math.round(cfg.protection * 100)}% for homes within ${cfg.radius} tiles`,
      dosed >= 0.999 ? `Every home supplied with ${name}` : dosed > 0 ? `${Math.round(dosed * 100)}% of homes supplied: short of ${name}` : `No ${name} in storage`,
    ]
  },
})
