// Dev-only helpers for visual review (exposed on window in dev builds; never used by the game itself).
import type { GameController } from './GameController'
import { networkIndex } from './sim/energy'
import { findSpot, footprintSize, placeBuilding } from './sim/placement'
import { createAutomaton } from './sim/population'

/**
 * Fills the area around the Steamforge with one finished copy of every building, completes all research, lays a
 * sample steam main and power line, and marks every building as working so gears, pistons, glows and vents animate.
 * Returns building ids by definition for camera tours.
 */
export function showcase(controller: GameController): Record<string, number> {
  const sim = controller.sim
  const hq = sim.headquarters()!
  sim.research.done = sim.content.bundle.research.map((t) => t.id)
  sim.research.queue = []
  const ids: Record<string, number> = { [hq.def]: hq.id }
  const cx = hq.x + 2
  const cy = hq.y + 2
  for (const def of sim.content.bundle.buildings) {
    if (def.buildable === false) continue
    const spot = findSpot(sim, def, cx, cy, 70, true)
    if (!spot) continue
    const [w, h] = footprintSize(def, 0)
    ids[def.id] = placeBuilding(sim, def, spot.x, spot.y, 0, w, h, true).id
  }
  // One row of each network along the plaza, clear of buildings: a water main, a steam duct upgraded to riveted and
  // lagged mains along its length, and a power line.
  const world = sim.world
  const rows: [number, string, (dx: number) => number][] = [
    [1, 'water', () => 0],
    [2, 'steam', (dx) => (dx < -3 ? 0 : dx < 4 ? 1 : 2)],
    [3, 'power', () => 0],
  ]
  for (const [dy, network, grade] of rows) {
    const n = networkIndex(sim, network)
    if (n < 0) continue
    for (let dx = -10; dx <= 10; dx++) {
      const i = world.index(cx + dx, cy + dy)
      if (!world.isLand(i) || world.building[i] !== 0) continue
      world.conduit[i] |= 1 << n
      world.setGrade(n, i, Math.min(grade(dx), sim.rules.networks[n].upgrades?.length ?? 0))
    }
  }
  // Tram rails along the next row, a few street lamps, automatons at the forge and a moored airship.
  const tram = sim.rules.roads.findIndex((r) => r.needsDepot) + 1
  // The nearest clear row south of the town for a 24-tile tram line.
  for (let dy = 6; tram && dy < 40; dy++) {
    const tiles = Array.from({ length: 24 }, (_, k) => world.index(cx - 12 + k, cy + dy))
    if (!tiles.every((i) => world.isLand(i) && world.building[i] === 0)) continue
    for (const i of tiles) {
      world.road[i] = tram
      world.feature[i] = 0
      sim.emit({ type: 'road', tile: i })
      sim.emit({ type: 'feature', tile: i })
    }
    break
  }
  const lamp = sim.content.buildings.get('gas-lamp')
  for (let dx = -9; lamp && dx <= 9; dx += 3) {
    const spot = findSpot(sim, lamp, cx + dx, cy + 6, 4, true)
    if (spot) placeBuilding(sim, lamp, spot.x, spot.y, 0, 1, 1, true)
  }
  for (let k = 0; k < 4; k++) createAutomaton(sim, world.xOf(hq.door) + 0.5 + k * 0.6, world.yOf(hq.door) + 1.5)
  for (const b of sim.buildings.values()) if (sim.def(b).components.airship) b.data.ship = 'moored'
  sim.energy.dirty = true
  for (const b of sim.buildings.values()) b.activeAt = 1e9
  controller.renderer.handleEvents([...sim.drainEvents(), { type: 'conduit', tile: 0 }, { type: 'feature', tile: -1 }])
  return ids
}
