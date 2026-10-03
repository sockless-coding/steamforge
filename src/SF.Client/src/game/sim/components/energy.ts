import { hqOutputFactor } from '../saga'
import { gridOf, headOf, type BoosterConfig, type ConsumerConfig, type GeneratorConfig } from '../energy'
import { amount, available, nearestStorageWith } from '../inventory'
import type { Simulation } from '../simulation'
import { gotoBuilding, reserveIncoming, reserveStock, task } from '../tasks'
import type { Building, Citizen, Task } from '../types'
import { onHand } from '../work'
import { registerComponent } from './registry'

function network(sim: Simulation, id: string) {
  return sim.rules.networks.find((n) => n.id === id)
}

/** The first fuel (in preference order) the building has on hand, or null. */
function fuelOnHand(b: Building, cfg: GeneratorConfig): string | null {
  for (const res of Object.keys(cfg.fuel ?? {})) if (amount(b.stock, res) > 1e-6) return res
  return null
}

function fuelHeld(b: Building, cfg: GeneratorConfig): number {
  let sum = 0
  for (const res of Object.keys(cfg.fuel ?? {})) sum += onHand(b, res)
  return sum
}

/** Fetches the most preferred fuel any other storage can spare. */
function refuelTask(sim: Simulation, _c: Citizen, b: Building, cfg: GeneratorConfig, kind: 'work' | 'labor'): Task | null {
  const capacity = cfg.capacity ?? 0
  const want = capacity - fuelHeld(b, cfg)
  if (!cfg.fuel || want < Math.max(1, capacity * 0.4)) return null
  for (const res of Object.keys(cfg.fuel)) {
    // Never from itself: the Steamforge is a storage too.
    const source = nearestStorageWith(sim, res, b.door, 1, b.id)
    if (!source) continue
    const qty = Math.min(want, sim.rules.citizen.carry, available(source, res))
    if (qty < 1) continue
    return task(kind, `Fuelling the ${sim.def(b).name}`, b.id, [
      gotoBuilding(source),
      { op: 'take', from: source.id, res, qty },
      gotoBuilding(b),
      { op: 'give', to: b.id },
    ], [reserveStock(source, res, qty), reserveIncoming(b, res, qty)])
  }
  return null
}

/**
 * Raises energy on a network: boilers burn fuel (and need a stoker on the payroll when the building has a
 * workplace), converters such as the dynamo turn one network's energy into another's. The energy system reads
 * `data.lit` and burns the fuel according to load.
 */
registerComponent<GeneratorConfig>({
  kind: 'generator',
  second: (sim, b, cfg) => {
    const staffed = !sim.def(b).components.workplace || b.workers.length > 0
    const fuel = cfg.fuel ? fuelOnHand(b, cfg) : null
    // A Steamforge under retrofit, sealed cold or ruptured raises nothing and burns nothing.
    const silenced = !!sim.def(b).headquarters && hqOutputFactor(sim) === 0
    b.data.lit = b.fire === 0 && staffed && !silenced && (!cfg.fuel || fuel !== null)
    if (fuel) b.data.fuel = fuel
    else delete b.data.fuel
    if (b.data.lit) b.activeAt = sim.second
  },
  work: (sim, b, cfg, c) => {
    const refuel = refuelTask(sim, c, b, cfg, 'work')
    if (refuel) return refuel
    const label = cfg.fuel ? 'Stoking the firebox' : 'Tending the machinery'
    return task('work', label, b.id, [gotoBuilding(b, true), { op: 'work', seconds: 12, effect: 'none', at: b.id }])
  },
  labor: (sim, b, cfg, c) => (sim.def(b).components.workplace ? null : refuelTask(sim, c, b, cfg, 'labor')),
  describe: (sim, b, cfg) => {
    const net = network(sim, cfg.network)
    const unit = net?.unit ?? ''
    const lines: string[] = []
    const grid = gridOf(sim, b, cfg.network)
    if (b.data.lit) {
      const load = grid && grid.supply > 0 ? Math.min(1, grid.demand / grid.supply) : 0
      lines.push(`${net?.name ?? cfg.network}: up to ${cfg.output} ${unit}, grid load ${Math.round(load * 100)}%`)
    } else if (sim.def(b).components.workplace && b.workers.length === 0) {
      lines.push('Cold: needs a worker on the payroll')
    } else if (cfg.fuel && b.data.lit === false) {
      lines.push(`Cold: out of ${Object.keys(cfg.fuel).map((r) => sim.resource(r)?.name.toLowerCase() ?? r).join(' or ')}`)
    }
    if (cfg.fuel) {
      const fuels = Object.keys(cfg.fuel).map((r) => `${Math.floor(amount(b.stock, r))} ${sim.resource(r)?.name.toLowerCase() ?? r}`)
      lines.push(`Fuel on hand: ${fuels.join(', ')}`)
    }
    if (grid) lines.push(`Grid: ${Math.round(grid.supply)} ${unit} supplied, ${Math.round(grid.demand)} ${unit} drawn`)
    return lines
  },
})

/** Draws energy from the networks the building is connected to. The energy system writes `data.power`. */
registerComponent<ConsumerConfig>({
  kind: 'consumer',
  describe: (sim, b, cfg) => {
    const lines: string[] = []
    const power = (b.data.power as number | undefined) ?? 0
    for (const [id, use] of Object.entries(cfg.uses)) {
      const net = network(sim, id)
      const grid = gridOf(sim, b, id)
      const name = net?.name ?? id
      if (!grid || grid.supply <= 0) lines.push(`${cfg.required ? 'Needs' : 'Can use'} ${use} ${net?.unit ?? ''} of ${name.toLowerCase()}: not connected`)
      else {
        const head = headOf(sim, b, id)
        const pressure = head < 0.995 ? `, pressure ${Math.round(head * 100)}% at this end of the main` : ''
        lines.push(`${name}: ${use} ${net?.unit ?? ''}, supplied ${Math.round(Math.min(1, grid.supply / Math.max(grid.demand, 1e-9)) * 100)}%${pressure}`)
      }
    }
    if (cfg.required && power < 0.05) lines.push('Idle without energy')
    else if (cfg.required && power < 0.99) lines.push(`Working at ${Math.round(power * 100)}% for lack of energy`)
    if (cfg.workBonus && power > 0) lines.push(`Energy boost: +${Math.round(cfg.workBonus * power * 100)}% work speed`)
    if (cfg.heatBonus && power > 0) lines.push(`Steam heating: ${Math.round(Math.min(1, cfg.heatBonus * power) * 100)}% of firewood saved`)
    return lines
  },
})


/** Booster pumps: the energy solver treats their footprint as a fresh source of head (see solveHeads). */
registerComponent<BoosterConfig>({
  kind: 'booster',
  describe: (sim, b, cfg) => {
    const net = network(sim, cfg.network)
    const power = (b.data.power as number | undefined) ?? 0
    return [power > 0.01 ? `Restoring ${net?.name.toLowerCase() ?? cfg.network} pressure to ${Math.round(cfg.head * Math.min(1, power / Math.max(headOf(sim, b, cfg.network), 1e-9)) * 100)}% downstream` : 'Idle: no pressure reaches the pump']
  },
})
