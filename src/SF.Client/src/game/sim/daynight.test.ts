import { describe, expect, it } from 'vitest'
import { indexContent } from '../../api/content'
import { eventHandler } from './events'
import { canPlace, findSpot, footprintSize, placeBuilding } from './placement'
import { Simulation, type ColonySnapshot } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

function build(sim: Simulation, def: string, x: number, y: number): Building {
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const check = canPlace(sim, d, x, y, 0, undefined, undefined, true)
  if (!check.ok) throw new Error(`${def} at ${x},${y}: ${check.reason}`)
  return placeBuilding(sim, d, x, y, 0, w, h, true)
}

function buildNear(sim: Simulation, def: string, x: number, y: number): Building {
  const spot = findSpot(sim, sim.def(def), x, y, 40)
  if (!spot) throw new Error(`no room for ${def}`)
  return build(sim, def, spot.x, spot.y)
}

/** Runs until the middle of the next night. */
function runToMidnight(sim: Simulation): void {
  while (sim.isNight) sim.step()
  while (!sim.isNight) sim.step()
  runSeconds(sim, sim.secondsUntilDawn() / 2)
}

const people = (sim: Simulation) => [...sim.citizens.values()].filter((c) => !c.automaton)

describe('day and night', () => {
  it('founds the colony at noon and lets winter nights run longer than summer ones', () => {
    const sim = newColony()
    expect(sim.dayProgress).toBeCloseTo(0.5)
    expect(sim.sun).toBeCloseTo(1)
    expect(sim.isNight).toBe(false)
    const nightTicks = (month: number) => {
      let n = 0
      for (let t = 0; t < sim.tpm; t++) {
        sim.tick = month * sim.tpm + t
        if (sim.isNight) n++
      }
      return n
    }
    const summer = nightTicks(4)
    const winter = nightTicks(10)
    expect(winter).toBeGreaterThan(summer)
    expect(summer / sim.tpm).toBeCloseTo(1 - sim.rules.day.daylight[4], 2)
  })

  it('sends citizens home to sleep after dark', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    runToMidnight(sim)
    const sleeping = people(sim).filter((c) => c.task?.label === 'Sleeping')
    expect(sleeping.length / people(sim).length).toBeGreaterThan(0.8)
    // By sunrise they are up again.
    runSeconds(sim, sim.secondsUntilDawn() + 6)
    expect(people(sim).filter((c) => c.task?.label === 'Sleeping').length).toBe(0)
  })

  it('keeps lamplit workplaces working through the night, more slowly', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    sim.research.done.push('gaslight')
    sim.perform({ type: 'research', tech: 'mining' })
    const hq = sim.headquarters()!
    const lit = buildNear(sim, 'drafting-office', hq.x + 10, hq.y)
    const dark = buildNear(sim, 'drafting-office', hq.x - 24, hq.y)
    buildNear(sim, 'gas-lamp', lit.x + lit.w + 1, lit.y)
    runSeconds(sim, 5)
    expect(lit.workers.length).toBeGreaterThan(0)
    expect(dark.workers.length).toBeGreaterThan(0)
    runToMidnight(sim)
    for (const id of lit.workers) expect(sim.citizens.get(id)!.task?.label).not.toBe('Sleeping')
    for (const id of dark.workers) expect(sim.citizens.get(id)!.task?.label).toBe('Sleeping')
  })

  it('picks up long jobs again the next morning instead of starting over', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const hq = sim.headquarters()!
    const office = buildNear(sim, 'drafting-office', hq.x + 10, hq.y)
    sim.perform({ type: 'research', tech: 'mining' })
    runSeconds(sim, 5)
    const worker = sim.citizens.get(office.workers[0])!
    // At nightfall the worker puts the job down part-way through...
    let shelved = 0
    for (let night = 0; night < 4 && !shelved; night++) {
      while (sim.isNight) sim.step()
      while (!sim.isNight) sim.step()
      sim.step()
      shelved = worker.shelved?.t ?? 0
    }
    expect(shelved).toBeGreaterThan(0)
    // ...and resumes it in the morning rather than starting over.
    runSeconds(sim, sim.secondsUntilDawn())
    while (worker.task?.steps[worker.task.i]?.op !== 'work') sim.step()
    sim.step()
    expect(worker.shelved).toBeUndefined()
    expect(worker.task!.t).toBeGreaterThan(shelved)
  })
})

describe('travellers', () => {
  function petition(sim: Simulation): void {
    const def = sim.content.bundle.events.find((e) => e.kind === 'nomads')!
    expect(eventHandler('nomads')!.run(sim, def)).toBe(true)
  }

  it('wait at the gate until the player welcomes them', () => {
    const sim = newColony()
    const before = sim.citizens.size
    petition(sim)
    const p = sim.petition!
    expect(sim.citizens.size).toBe(before)
    expect(p.adults + p.children).toBeGreaterThanOrEqual(3)
    // Only one group waits at a time.
    expect(eventHandler('nomads')!.run(sim, sim.content.bundle.events.find((e) => e.kind === 'nomads')!)).toBe(false)
    expect(sim.perform({ type: 'answerPetition', accept: true }).ok).toBe(true)
    expect(sim.petition).toBeNull()
    expect(sim.citizens.size).toBe(before + p.adults + p.children)
    expect(sim.stats.arrivals).toBe(p.adults + p.children)
  })

  it('move on when turned away or left waiting', () => {
    const sim = newColony()
    const before = sim.citizens.size
    petition(sim)
    sim.perform({ type: 'answerPetition', accept: false })
    expect(sim.citizens.size).toBe(before)
    expect(sim.perform({ type: 'answerPetition', accept: true }).ok).toBe(false)
    petition(sim)
    runMonths(sim, 1.1)
    expect(sim.petition).toBeNull()
    expect(sim.citizens.size).toBeLessThanOrEqual(before)
  })

  it('carry their fever into the colony', () => {
    const sim = newColony()
    petition(sim)
    sim.petition!.feverish = true
    sim.perform({ type: 'answerPetition', accept: true })
    expect([...sim.citizens.values()].filter((c) => c.sick > 0).length).toBeGreaterThan(0)
  })
})

describe('events', () => {
  it('fever strikes children and elders hardest', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const fever = sim.content.bundle.events.find((e) => e.kind === 'sickness')!
    eventHandler('sickness')!.run(sim, { ...fever, params: { ...fever.params, fraction: 1 } })
    const adult = people(sim).find((c) => c.age >= 12 * sim.rules.citizen.adultAge && c.age < 12 * sim.rules.citizen.elderAge)!
    const child = people(sim).find((c) => c.age < 12 * sim.rules.citizen.adultAge)!
    expect(child.sickRate).toBeCloseTo(adult.sickRate * (fever.params.vulnerableFactor as number))
  })

  it('spaces disasters apart, however likely they are', () => {
    const rules = content.bundle.rules
    const stormy = indexContent({ ...content.bundle, rules: { ...rules, events: { ...rules.events, disastersPerYear: 1000 } } })
    const sim = Simulation.create(stormy, { seed: 5, name: 'Stormford', difficulty: 'tinkerer', mapSize: 'small', terrain: 'valley' })
    const months = new Set<number>()
    for (let m = 0; m < 12 * 3 && sim.outcome === 'playing'; m++) {
      runMonths(sim, 1)
      if (sim.lastDisaster >= 0) months.add(sim.lastDisaster)
    }
    const list = [...months].sort((a, b) => a - b)
    expect(list.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < list.length; i++) expect(list[i] - list[i - 1]).toBeGreaterThanOrEqual(rules.events.minMonthsBetweenDisasters)
  })
})

describe('saves', () => {
  it('reproduce the same future through the night and with travellers waiting', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    runToMidnight(sim)
    const def = sim.content.bundle.events.find((e) => e.kind === 'nomads')!
    eventHandler('nomads')!.run(sim, def)
    const copy = Simulation.deserialize(content, sim.serialize())
    runMonths(sim, 2)
    runMonths(copy, 2)
    expect(JSON.stringify(copy.serialize())).toBe(JSON.stringify(sim.serialize()))
  })

  it('migrate version 3 colonies to the longer month without losing their date', () => {
    const sim = newColony()
    runMonths(sim, 5.5)
    const snap = sim.serialize()
    const v3 = { ...snap, v: 3, tick: Math.round((snap.tick * 400) / sim.tpm) } as Partial<ColonySnapshot>
    delete v3.petition
    delete v3.lastDisaster
    const loaded = Simulation.deserialize(content, v3 as ColonySnapshot)
    expect(loaded.monthIndex).toBe(sim.monthIndex)
    expect(loaded.monthProgress).toBeCloseTo(sim.monthProgress, 2)
    expect(loaded.petition).toBeNull()
  })
})
