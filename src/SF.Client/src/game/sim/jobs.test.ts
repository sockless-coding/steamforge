import { describe, expect, it } from 'vitest'
import { computeTotals, foodIds } from './inventory'
import { findSpot, footprintSize, placeBuilding } from './placement'
import { chooseTask } from './ai'
import { assignJobs } from './population'
import type { Simulation } from './simulation'
import { newColony } from './testing'
import type { Building } from './types'

function prebuild(sim: Simulation, def: string): Building {
  const hq = sim.headquarters()!
  const d = sim.def(def)
  const spot = findSpot(sim, d, hq.x + 12, hq.y, 60, true)!
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

  it('moves a chosen worker to another job even when nobody is idle, and keeps them there', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const quarries = employEveryone(sim)
    const field = prebuild(sim, 'crop-field')
    sim.perform({ type: 'setWorkers', building: field.id, count: 0 })
    const quarry = quarries.find((q) => q.workers.length > 0)!
    const worker = sim.citizens.get(quarry.workers[0])!
    expect(sim.perform({ type: 'assignCitizen', citizen: worker.id, job: field.id })).toEqual({ ok: true })
    expect(worker.workplace).toBe(field.id)
    expect(worker.pinned).toBe(true)
    // The field's target rises to take them, and the overseer leaves them be.
    expect(field.workerTarget).toBe(1)
    assignJobs(sim)
    expect(field.workers).toEqual([worker.id])
  })

  it('lets go of the workers it placed itself before those the player chose', () => {
    const sim = newColony({ difficulty: 'engineer' })
    const quarries = employEveryone(sim)
    const office = prebuild(sim, 'drafting-office')
    sim.perform({ type: 'setWorkers', building: office.id, count: 2 })
    const busiest = quarries.reduce((a, z) => (z.workers.length > a.workers.length ? z : a))
    sim.perform({ type: 'setWorkers', building: busiest.id, count: busiest.workers.length - 2 })
    assignJobs(sim)
    expect(office.workers.length).toBe(2)
    const chosen = office.workers[1]
    sim.perform({ type: 'assignCitizen', citizen: chosen, job: office.id })
    sim.perform({ type: 'setWorkers', building: office.id, count: 1 })
    expect(office.workers).toEqual([chosen])
  })

  it('keeps chosen laborers and builders out of the overseer’s hands until released', () => {
    const sim = newColony({ difficulty: 'engineer' })
    employEveryone(sim)
    const office = prebuild(sim, 'drafting-office')
    const c = [...sim.citizens.values()].find((x) => x.workplace)!
    sim.perform({ type: 'assignCitizen', citizen: c.id, job: 'laborer' })
    assignJobs(sim)
    expect(c.workplace).toBe(0)
    expect(office.workers).toEqual([])
    sim.perform({ type: 'assignCitizen', citizen: c.id, job: 'builder' })
    expect(c.profession).toBe('builder')
    expect(sim.builderTarget).toBe(1)
    sim.perform({ type: 'assignCitizen', citizen: c.id, job: 'auto' })
    sim.perform({ type: 'setBuilders', count: 0 })
    assignJobs(sim)
    expect(c.pinned).toBeUndefined()
    expect(office.workers).toEqual([c.id])
  })

  it('sends a worker with nothing to do to a workplace of the same trade that has work', () => {
    const sim = newColony({ difficulty: 'engineer' })
    employEveryone(sim)
    for (const s of sim.storages()) delete s.stock.leather
    sim.totals = computeTotals(sim)
    const idle = prebuild(sim, 'tailor')
    const busy = prebuild(sim, 'tailor')
    busy.stock.leather = 6
    const c = sim.citizens.get(sim.buildings.get([...sim.citizens.values()].find((x) => x.workplace)!.workplace)!.workers[0])!
    sim.perform({ type: 'assignCitizen', citizen: c.id, job: idle.id })
    Object.assign(c, { hunger: 1, warmth: 1, tools: 30, coat: 30, task: null })
    // Placed by the player, they stay at their own bench.
    expect(chooseTask(sim, c)?.label).not.toBe('Sew coats')
    expect(c.workplace).toBe(idle.id)
    sim.perform({ type: 'assignCitizen', citizen: c.id, job: 'auto' })
    const t = chooseTask(sim, c)
    expect(t?.label).toBe('Sew coats')
    expect(c.workplace).toBe(busy.id)
    expect(busy.workers).toContain(c.id)
    expect(idle.workers).not.toContain(c.id)
  })
})
