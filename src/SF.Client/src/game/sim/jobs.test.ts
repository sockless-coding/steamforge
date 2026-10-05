import { describe, expect, it } from 'vitest'
import { computeTotals, foodIds } from './inventory'
import { findSpot, footprintSize, placeBuilding } from './placement'
import { assignJobs } from './population'
import type { Simulation } from './simulation'
import { newColony } from './testing'
import type { Building } from './types'

function prebuild(sim: Simulation, def: string): Building {
  const hq = sim.headquarters()!
  const d = sim.def(def)
  const spot = findSpot(sim, d, hq.x + 12, hq.y, 60)!
  return placeBuilding(sim, d, spot.x, spot.y, 0, ...footprintSize(d, 0), true)
}

const freeAdults = (sim: Simulation) =>
  [...sim.citizens.values()].filter((c) => c.age >= sim.rules.citizen.adultAge * 12 && c.profession === 'laborer' && !c.workplace).length

/** Builds quarries until every adult has a job, so later workplaces can only be staffed by moving people. */
function employEveryone(sim: Simulation): Building[] {
  sim.perform({ type: 'setBuilders', count: 0 })
  const quarries: Building[] = []
  for (assignJobs(sim); freeAdults(sim) > 0; assignJobs(sim)) quarries.push(prebuild(sim, 'quarry'))
  return quarries
}

describe('job assignment', () => {
  it('gives a workplace finished late a hand before any trade gets another', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const quarries = employEveryone(sim)
    const free = () => {
      const busiest = quarries.reduce((a, b) => (b.workers.length > a.workers.length ? b : a))
      sim.perform({ type: 'setWorkers', building: busiest.id, count: busiest.workers.length - 1 })
      assignJobs(sim)
    }
    const field = prebuild(sim, 'crop-field')
    // Food is plentiful, so nobody is moved; a freed adult goes to the field (food wins a tie)...
    free()
    expect(field.workers.length).toBe(1)
    // ...but the next goes to the empty drafting office, not the field's second place.
    const office = prebuild(sim, 'drafting-office')
    free()
    expect(office.workers.length).toBe(1)
    expect(field.workers.length).toBe(1)
  })

  it('moves hands to food workplaces when the stores run short of food, never a trade’s last', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const quarries = employEveryone(sim)
    for (const s of sim.storages()) for (const f of foodIds(sim)) delete s.stock[f]
    sim.totals = computeTotals(sim)
    const field = prebuild(sim, 'crop-field')
    assignJobs(sim)
    expect(field.workers.length).toBeGreaterThan(0)
    for (const q of quarries) expect(q.workers.length).toBeGreaterThanOrEqual(1)
  })
})
