import { describe, expect, it } from 'vitest'
import { networkIndex } from './energy'
import { canPlace, footprintSize, placeBuilding } from './placement'
import { hqOutputFactor } from './saga'
import type { Simulation } from './simulation'
import { newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

/** Free spots for a building sharing a wall with another, in a fixed order. */
function spotsBeside(sim: Simulation, other: Building, def: string): [number, number][] {
  const [w, h] = footprintSize(sim.def(def), 0)
  const spots: [number, number][] = []
  for (let dx = 1 - w; dx < other.w; dx++) spots.push([other.x + dx, other.y - h], [other.x + dx, other.y + other.h])
  for (let dy = 1 - h; dy < other.h; dy++) spots.push([other.x - w, other.y + dy], [other.x + other.w, other.y + dy])
  return spots.filter(([x, y]) => canPlace(sim, sim.def(def), x, y, 0, undefined, undefined, true).ok)
}

/** A finished building against another's walls. */
function beside(sim: Simulation, other: Building, def: string): Building {
  const spot = spotsBeside(sim, other, def)[0]
  if (!spot) throw new Error(`no room for ${def} beside ${other.def}`)
  const [w, h] = footprintSize(sim.def(def), 0)
  return placeBuilding(sim, sim.def(def), spot[0], spot[1], 0, w, h, true)
}

describe('forge works', () => {
  it('must be built against the Steamforge', () => {
    const sim = newColony({ seed: 5, difficulty: 'engineer' })
    const forge = sim.headquarters()!
    const blower = sim.def('draught-blower')
    const away = canPlace(sim, blower, forge.x + forge.w + 6, forge.y + forge.h + 6, 0)
    expect(away.ok ? '' : away.reason).toMatch(/against the Steamforge/)
    // Touching only a corner is not against its walls.
    const corner = canPlace(sim, blower, forge.x + forge.w, forge.y + forge.h, 0)
    expect(corner.ok).toBe(false)
    const [x, y] = spotsBeside(sim, forge, 'draught-blower')[0]
    expect(sim.perform({ type: 'place', def: blower.id, x, y, rot: 0 }).ok).toBe(true)
    expect(sim.perform({ type: 'place', def: blower.id, x, y, rot: 0 }).ok).toBe(false)
  })

  it('wait for research before the first', () => {
    const sim = newColony({ seed: 5, difficulty: 'engineer' })
    expect(sim.unlocked('draught-blower')).toBe(true)
    expect(sim.unlocked('auxiliary-firebox')).toBe(false)
    expect(sim.unlocked('feedwater-economiser')).toBe(false)
  })

  it('raise the Steamforge’s steam only once built', () => {
    const sim = newColony({ seed: 5, difficulty: 'engineer' })
    const forge = sim.headquarters()!
    const steam = networkIndex(sim, 'steam')
    forge.stock.coal = 40
    runSeconds(sim, 3)
    expect(sim.energy.totals[steam].supply).toBeCloseTo(12, 5)

    const [x, y] = spotsBeside(sim, forge, 'draught-blower')[0]
    const placed = sim.perform({ type: 'place', def: 'draught-blower', x, y, rot: 0 })
    if (!placed.ok || !placed.building) throw new Error('blower not placed')
    runSeconds(sim, 3)
    // Still a construction site: no extra steam yet.
    expect(sim.buildings.get(placed.building)!.site).not.toBeNull()
    expect(sim.energy.totals[steam].supply).toBeCloseTo(12, 5)

    sim.perform({ type: 'cancelSite', building: placed.building })
    beside(sim, forge, 'draught-blower')
    beside(sim, forge, 'auxiliary-firebox')
    beside(sim, forge, 'feedwater-economiser')
    runSeconds(sim, 3)
    expect(hqOutputFactor(sim)).toBeCloseTo(1 + 0.3 + 0.35 + 0.4, 5)
    expect(sim.energy.totals[steam].supply).toBeCloseTo(12 * 2.05, 5)
  })

  it('burn more fuel at full load, except the economiser', () => {
    const coalPerMonth = (works: string[]) => {
      const sim = newColony({ seed: 5, difficulty: 'engineer' })
      const forge = sim.headquarters()!
      for (const w of works) beside(sim, forge, w)
      // Tram depots always draw steam: four of them keep the forge at full load.
      for (let i = 0; i < 4; i++) beside(sim, forge, 'tram-depot')
      forge.stock.coal = 60
      runSeconds(sim, 3)
      const before = sim.stats.consumed.coal ?? 0
      runMonths(sim, 1)
      return (sim.stats.consumed.coal ?? 0) - before
    }
    const base = coalPerMonth([])
    expect(base).toBeGreaterThan(0)
    expect(coalPerMonth(['auxiliary-firebox']) / base).toBeCloseTo(1.35, 1)
    expect(coalPerMonth(['feedwater-economiser']) / base).toBeCloseTo(1, 1)
  })
})
