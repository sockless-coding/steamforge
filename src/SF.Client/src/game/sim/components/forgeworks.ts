import type { Simulation } from '../simulation'
import type { Building } from '../types'
import { registerComponent } from './registry'

/** An add-on built against the Steamforge's walls (`placement.adjoins`): it raises more steam, and may burn more fuel. */
export interface ForgeWorksConfig {
  /** Share of the Steamforge's base output added (0.3 = +30%). */
  output: number
  /** Share of the Steamforge's fuel burn added. */
  fuel?: number
}

/** Whether a forge works building is standing and in service (built and not burning). */
function inService(b: Building): boolean {
  return !b.site && b.fire === 0
}

/** The forge works in service, in insertion order, with their configs. */
export function forgeWorks(sim: Simulation): [Building, ForgeWorksConfig][] {
  const works: [Building, ForgeWorksConfig][] = []
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<ForgeWorksConfig>(b, 'forgeWorks')
    if (cfg && inService(b)) works.push([b, cfg])
  }
  return works
}

/** The forge works' multipliers on the Steamforge's output and on its fuel burn (both 1 with none). */
export function forgeWorksFactors(sim: Simulation): { output: number; fuel: number } {
  let output = 1
  let fuel = 1
  for (const [, cfg] of forgeWorks(sim)) {
    output += cfg.output
    fuel += cfg.fuel ?? 0
  }
  return { output, fuel }
}

registerComponent<ForgeWorksConfig>({
  kind: 'forgeWorks',
  // The works run with the Steamforge's fire: their fans spin and furnace mouths glow while it is lit.
  second: (sim, b) => {
    if (inService(b) && sim.headquarters()?.data.lit === true) b.activeAt = sim.second
  },
  describe: (sim, b, cfg) => {
    const fuel = cfg.fuel ? `, burning ${Math.round(cfg.fuel * 100)}% more fuel` : ', at no extra fuel'
    const lines = [`Steamforge output +${Math.round(cfg.output * 100)}%${fuel}`]
    if (b.fire > 0) lines.push('Out of service while it burns')
    else if (sim.headquarters()?.data.lit !== true) lines.push('Idle: the Steamforge is cold')
    return lines
  },
})
