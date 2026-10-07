import { describe, expect, it } from 'vitest'
import { concerns, flowOf, outOf, workplaceRows } from './report'
import { findSpot, footprintSize, placeBuilding } from './sim/placement'
import { LEDGER_MONTHS, Simulation, SAVE_VERSION, type ColonySnapshot } from './sim/simulation'
import { content, newColony, runMonths } from './sim/testing'

describe("the colony's books", () => {
  it('close every month with the stores, the people, and what was made and used', () => {
    const sim = newColony()
    runMonths(sim, 3)
    const ledger = sim.stats.ledger
    expect(ledger.map((m) => m.m)).toEqual([0, 1, 2])
    const last = ledger[2]
    expect(last.people).toBe(sim.population().total)
    // Everyone eats: some food left the stores, and the books agree with the lifetime totals.
    const foods = content.bundle.resources.filter((r) => r.category === 'food').map((r) => r.id)
    expect(foods.reduce((s, f) => s + flowOf(last, f).used, 0)).toBeGreaterThan(0)
    for (const res of Object.keys(sim.stats.produced)) {
      const booked = ledger.reduce((s, m) => s + (m.made[res] ?? 0), 0) + (sim.stats.month.made[res] ?? 0)
      expect(booked).toBeCloseTo(sim.stats.produced[res], 0)
    }
  })

  it('count construction materials and replaced tools as used', () => {
    const sim = newColony()
    const hq = sim.headquarters()!
    const cottage = sim.def('cottage')
    const spot = findSpot(sim, cottage, hq.x + 8, hq.y + 8, 30)!
    expect(
      sim.perform({
        type: 'place',
        def: 'cottage',
        x: spot.x,
        y: spot.y,
        rot: 0,
      }).ok,
    ).toBe(true)
    runMonths(sim, 12)
    const used = (key: string) => sim.stats.ledger.reduce((s, m) => s + (m.used[key] ?? 0), 0)
    // The cottage's materials were used up in building it; tools wear out and are replaced within the year.
    for (const [res, qty] of Object.entries(cottage.cost.resources)) expect(used(`built:${res}`)).toBeCloseTo(qty, 0)
    expect(sim.stats.consumed.tools ?? 0).toBeGreaterThan(0)
    expect(
      outOf(
        flowOf(
          {
            made: {},
            used: {
              tools: 1,
              'built:tools': 2,
              'spoiled:tools': 3,
              'export:tools': 4,
            },
          },
          'tools',
        ),
      ),
    ).toBe(10)
  })

  it(`keep ${LEDGER_MONTHS} months and survive a save without changing the future`, () => {
    const sim = newColony()
    runMonths(sim, 2)
    sim.stats.ledger = Array.from({ length: LEDGER_MONTHS }, (_, i) => ({
      m: i - LEDGER_MONTHS,
      people: 1,
      stock: {},
      made: {},
      used: {},
    }))
    runMonths(sim, 1)
    expect(sim.stats.ledger.length).toBe(LEDGER_MONTHS)
    expect(sim.stats.ledger.at(-1)!.m).toBe(2)

    const loaded = Simulation.deserialize(content, sim.serialize())
    runMonths(sim, 2)
    runMonths(loaded, 2)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(sim.serialize()))
  })

  it('open the books on version 9 saves', () => {
    const sim = newColony()
    const s = JSON.parse(JSON.stringify(sim.serialize())) as ColonySnapshot
    s.v = 9
    delete (s.stats as Partial<typeof s.stats>).ledger
    delete (s.stats as Partial<typeof s.stats>).month
    const loaded = Simulation.deserialize(content, s)
    expect(loaded.serialize().v).toBe(SAVE_VERSION)
    runMonths(loaded, 1)
    expect(loaded.stats.ledger.length).toBe(1)
  })
})

describe("the overseer's report", () => {
  it('list each workplace with its crew and what holds it up', () => {
    const sim = newColony()
    const hq = sim.headquarters()!
    const d = sim.def('hunters-lodge')
    const spot = findSpot(sim, d, hq.x + 12, hq.y, 40)!
    const lodge = placeBuilding(sim, d, spot.x, spot.y, 0, ...footprintSize(d, 0), true)
    sim.perform({ type: 'setWorkers', building: lodge.id, count: 0 })
    expect(workplaceRows(sim).find((w) => w.id === lodge.id)?.status).toBe('stoodDown')

    lodge.workerTarget = sim.maxWorkers(lodge)
    lodge.stock.venison = sim.rules.workplace.outputBuffer
    lodge.workers = [...sim.citizens.keys()].slice(0, 1)
    for (const s of sim.storages()) s.stock = { stone: 1e6 }
    sim.totals = { stone: 1e6 }
    const row = workplaceRows(sim).find((w) => w.id === lodge.id)!
    expect(row.status).toBe('storesFull')
    expect(concerns(sim, workplaceRows(sim)).some((c) => c.building === lodge.id && c.text.includes('No storage has room'))).toBe(true)
  })

  it('raise empty larders first', () => {
    const sim = newColony()
    for (const s of sim.storages()) for (const r of content.bundle.resources) if (r.category === 'food') delete s.stock[r.id]
    sim.totals = {}
    const list = concerns(sim, workplaceRows(sim))
    expect(list[0].level).toBe('bad')
    expect(list[0].text).toMatch(/Food will run out/)
  })
})
