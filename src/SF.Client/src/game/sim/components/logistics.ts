import { energyBlocked, generatorOf, networkIndex } from '../energy'
import { burnable, ignite } from '../events'
import { addStock, available, freeSpace } from '../inventory'
import type { Simulation } from '../simulation'
import { registerSystem } from '../systems'
import type { Building } from '../types'
import { registerComponent } from './registry'

// ---------------------------------------------------------------- steam tramways

/** A tram depot keeps the steam trams running: tramway roads are only fast while one has steam. */
registerComponent({
  kind: 'tramDepot',
  describe: (sim, b) => [energyBlocked(sim, b) ? 'Trams stopped: the depot needs steam' : 'Trams running on every tramway'],
})

/** Sets tramway speeds from whether any tram depot is powered. Derived from saved state, so safe on restore. */
export function updateTramways(sim: Simulation): void {
  let running = false
  for (const b of sim.buildings.values()) {
    if (!b.site && b.fire === 0 && sim.def(b).components.tramDepot && !energyBlocked(sim, b)) {
      running = true
      break
    }
  }
  sim.rules.roads.forEach((road, i) => {
    if (road.needsDepot) sim.world.roadSpeeds[i] = running ? road.speed : (road.unpoweredSpeed ?? 1)
  })
}

registerSystem({ id: 'tramways', second: updateTramways, restore: updateTramways })

// ---------------------------------------------------------------- pneumatic tubes

export interface PneumaticConfig {
  /** Depots joined by this network's grid share their goods. */
  network: string
}

registerComponent<PneumaticConfig>({
  kind: 'pneumatic',
  describe: (sim, b) => [energyBlocked(sim, b) ? 'Tubes idle: needs steam' : 'Shares goods by tube with every depot on its steam grid'],
})

/**
 * Every second, powered pneumatic depots on the same grid even out their unreserved goods, so whatever is
 * delivered to one depot can be collected at any other.
 */
export function balanceDepots(sim: Simulation): void {
  const groups = new Map<string, Building[]>()
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<PneumaticConfig>(b, 'pneumatic')
    if (!cfg || b.site || b.fire > 0 || energyBlocked(sim, b)) continue
    const grid = sim.energy.grids[networkIndex(sim, cfg.network)]?.get(b.id)
    if (!grid) continue
    const key = `${cfg.network}:${grid}`
    const list = groups.get(key) ?? []
    list.push(b)
    groups.set(key, list)
  }
  for (const depots of groups.values()) {
    if (depots.length < 2) continue
    const resources = new Set<string>()
    for (const d of depots) for (const res in d.stock) resources.add(res)
    for (const res of [...resources].sort()) {
      let sum = 0
      for (const d of depots) sum += available(d, res)
      const share = sum / depots.length
      const givers = depots.filter((d) => available(d, res) > share + 1)
      const takers = depots.filter((d) => available(d, res) < share - 1)
      for (const taker of takers) {
        for (const giver of givers) {
          const want = Math.min(share - available(taker, res), available(giver, res) - share, freeSpace(sim, taker))
          if (want < 1) continue
          addStock(giver.stock, res, -want)
          addStock(taker.stock, res, want)
        }
      }
    }
  }
}

registerSystem({ id: 'pneumatics', second: balanceDepots })

// ---------------------------------------------------------------- boiler pressure

/** A safety valve on a steam grid vents excess pressure, so overloaded boilers on it never burst. */
registerComponent({
  kind: 'valve',
  describe: () => ['Protects every boiler on its grid from bursting under overload'],
})

/**
 * Overloaded steam grids (more drawn than raised) drive their boilers past safe pressure: each month a boiler on
 * such a grid may burst into flames, unless a safety valve sits on the grid. The Steamforge never bursts.
 */
export function checkPressure(sim: Simulation): void {
  if (sim.monthIndex < sim.rules.events.graceYears * sim.rules.months.length) return
  const burst = sim.content.events.get('boiler-burst')
  sim.rules.networks.forEach((net, n) => {
    const members = sim.energy.grids[n]
    const status = sim.energy.status[n]
    if (!members || !status) return
    const valved = new Set<number>()
    for (const [id, grid] of members) if (sim.buildings.get(id) && sim.def(sim.buildings.get(id)!).components.valve) valved.add(grid)
    const warned = new Set<number>()
    for (const [id, grid] of members) {
      const b = sim.buildings.get(id)
      const s = status[grid]
      if (!b || !s || s.supply <= 0 || valved.has(grid)) continue
      const gen = generatorOf(sim, b)
      if (gen?.network !== net.id || !gen.fuel || b.data.lit !== true || !burnable(sim, b)) continue
      const overload = s.demand / s.supply
      if (overload <= 1.1) continue
      if (burst && sim.rng.chance(Math.min(0.5, 0.25 * (overload - 1)) * sim.mods.disasterRate)) {
        ignite(sim, b, burst)
        sim.notify('bad', `Overpressure! The ${sim.def(b).name} has burst. Build a safety valve on the grid, or more boilers.`, b.door)
      } else if (!warned.has(grid)) {
        warned.add(grid)
        sim.notify('warn', `The ${sim.def(b).name} is straining: ${Math.round(overload * 100)}% load. A safety valve would keep it from bursting.`, b.door)
      }
    }
  })
}

registerSystem({ id: 'pressure', month: checkPressure })
