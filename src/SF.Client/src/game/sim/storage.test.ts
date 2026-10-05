import { describe, expect, it } from 'vitest'
import { addToStorage, freeSpace, storageConfig, total } from './inventory'
import { findSpot, footprintSize, placeBuilding } from './placement'
import type { Simulation } from './simulation'
import { newColony, runSeconds } from './testing'
import type { Building } from './types'
import { systems } from './systems'
import { storageBlocked } from './work'

function prebuild(sim: Simulation, def: string): Building {
  const hq = sim.headquarters()!
  const d = sim.def(def)
  const spot = findSpot(sim, d, hq.x + 12, hq.y, 40)!
  return placeBuilding(sim, d, spot.x, spot.y, 0, ...footprintSize(d, 0), true)
}

describe('stores', () => {
  it('found every colony with its supplies within the stores, materials in the specialised ones', () => {
    for (const difficulty of ['tinkerer', 'engineer', 'ironclad', 'inferno']) {
      const sim = newColony({ difficulty })
      for (const s of sim.storages()) expect(total(s.stock), `${difficulty} ${s.def}`).toBeLessThanOrEqual(storageConfig(sim, s)!.capacity)
      const yard = sim.storages().find((s) => s.def === 'stockyard')
      if (yard) expect(sim.headquarters()!.stock.logs ?? 0).toBe(0)
    }
  })

  it('clear a crowded Steamforge into a stockyard so the hunt can come in', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const hq = sim.headquarters()!
    // Logs stacked to the rafters, as when foresters work beside the forge.
    addToStorage(sim, 'logs', freeSpace(sim, hq), hq.door)
    expect(freeSpace(sim, hq)).toBeLessThan(1)
    const logs = hq.stock.logs
    const lodge = prebuild(sim, 'hunters-lodge')
    runSeconds(sim, sim.rules.secondsPerMonth)
    expect(hq.stock.logs ?? 0).toBeLessThan(logs)
    expect(sim.storages().some((s) => s.def === 'stockyard' && (s.stock.logs ?? 0) > 0)).toBe(true)
    expect(hq.stock.venison ?? 0).toBeGreaterThan(0)
    expect(storageBlocked(sim, lodge)).toBe(false)
  })

  it('warn when a workplace stands idle because nothing has room for its goods', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const hq = sim.headquarters()!
    addToStorage(sim, 'rations', freeSpace(sim, hq), hq.door)
    const lodge = prebuild(sim, 'hunters-lodge')
    expect(storageBlocked(sim, lodge)).toBe(false)
    lodge.stock.venison = sim.rules.workplace.outputBuffer
    expect(storageBlocked(sim, lodge)).toBe(true)
    systems.find((s) => s.id === 'outcome')!.month!(sim)
    expect(sim.notices.some((n) => n.text.startsWith('The stores are full'))).toBe(true)
  })
})
