import { describe, expect, it } from 'vitest'
import { amenityByHome } from './components/amenity'
import { balanceDepots, checkPressure } from './components/logistics'
import { canPlace, footprintSize, placeBuilding } from './placement'
import { networkIndex } from './energy'
import { createAutomaton } from './population'
import { Simulation } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

function build(sim: Simulation, def: string, x: number, y: number): Building {
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const check = canPlace(sim, d, x, y, 0, undefined, undefined, true)
  if (!check.ok) throw new Error(`${def} at ${x},${y}: ${check.reason}`)
  return placeBuilding(sim, d, x, y, 0, w, h, true)
}

/** A finished building on a free spot sharing an edge with the Steamforge (so it shares its steam). */
function besideForge(sim: Simulation, def: string): Building {
  const forge = sim.headquarters()!
  const [w, h] = footprintSize(sim.def(def), 0)
  const spots: [number, number][] = []
  for (let dx = 1 - w; dx < forge.w; dx++) spots.push([forge.x + dx, forge.y - h], [forge.x + dx, forge.y + forge.h])
  for (let dy = 1 - h; dy < forge.h; dy++) spots.push([forge.x - w, forge.y + dy], [forge.x + forge.w, forge.y + dy])
  for (const [x, y] of spots) if (canPlace(sim, sim.def(def), x, y, 0, undefined, undefined, true).ok) return build(sim, def, x, y)
  throw new Error(`no room for ${def} beside the Steamforge`)
}

/** Lays brick steam duct directly (as if builders had finished it). */
function lay(sim: Simulation, tiles: number[]): void {
  for (const t of tiles) sim.world.conduit[t] |= 1 << networkIndex(sim, 'steam')
  sim.energy.dirty = true
}

function row(sim: Simulation, x0: number, x1: number, y: number): number[] {
  const out: number[] = []
  for (let x = x0; x <= x1; x++) out.push(sim.world.index(x, y))
  return out
}

describe('gaslight', () => {
  it('gas lamps make nearby homes happier, up to a cap', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const home = [...sim.buildings.values()].find((b) => b.def === 'cottage')!
    expect(amenityByHome(sim).get(home.id)).toBeUndefined()
    const spots: [number, number][] = []
    sim.world.forRadius(home.x + 1, home.y + 1, 5, (i) => {
      const x = sim.world.xOf(i)
      const y = sim.world.yOf(i)
      if (canPlace(sim, sim.def('gas-lamp'), x, y, 0, undefined, undefined, true).ok) spots.push([x, y])
    })
    build(sim, 'gas-lamp', ...spots[0])
    expect(amenityByHome(sim).get(home.id)).toBeCloseTo(0.06, 5)
    for (const spot of spots.slice(1, 12)) if (canPlace(sim, sim.def('gas-lamp'), ...spot, 0, undefined, undefined, true).ok) build(sim, 'gas-lamp', ...spot)
    expect(amenityByHome(sim).get(home.id)).toBeCloseTo(0.25, 5)
  })

  it('the clock tower only cheers the town while it has steam', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    const clock = build(sim, 'clock-tower', forge.x + forge.w + 6, forge.y)
    runSeconds(sim, 2)
    expect(clock.data.power).toBe(0)
    const before = [...amenityByHome(sim).values()].length
    lay(sim, row(sim, forge.x + forge.w, clock.x - 1, forge.y))
    runSeconds(sim, 2)
    expect(clock.data.power).toBeGreaterThan(0.5)
    expect([...amenityByHome(sim).values()].length).toBeGreaterThan(before)
  })
})

describe('airship trade', () => {
  it('credits exports on delivery and unloads paid imports when the airship moors', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const mast = besideForge(sim, 'airship-mast')
    expect(sim.perform({ type: 'setTrade', res: 'logs', mode: 'export', amount: 40 }).ok).toBe(true)
    expect(sim.perform({ type: 'setTrade', res: 'iron', mode: 'import', amount: 30 }).ok).toBe(true)
    runMonths(sim, 1)
    expect(mast.data.power).toBeCloseTo(1, 5)
    expect(sim.credit).toBeGreaterThan(20)
    expect(sim.totals.logs ?? 0).toBeGreaterThanOrEqual(39)
    // Bring the next call forward.
    mast.data.nextVisit = 1
    const credit = sim.credit
    runMonths(sim, 1)
    runSeconds(sim, 14)
    expect(sim.credit).toBeLessThan(credit)
    expect(sim.notices.some((n) => n.text.includes('airship has moored and unloaded'))).toBe(true)
    runMonths(sim, 1)
    expect(sim.totals.iron ?? 0).toBeGreaterThan(20)
  })

  it('refuses goods the Company does not value', () => {
    const sim = newColony()
    expect(sim.perform({ type: 'setTrade', res: 'unobtainium', mode: 'export', amount: 0 }).ok).toBe(false)
  })
})

describe('automatons', () => {
  it('are not counted towards the peak population', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    const peak = sim.stats.peakPopulation
    createAutomaton(sim, sim.world.xOf(forge.door) + 0.5, sim.world.yOf(forge.door) + 0.5)
    expect(sim.stats.peakPopulation).toBe(peak)
  })

  it('work without food, warmth or a home, and wind themselves with coal', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    forge.stock.coal = 20
    const bot = createAutomaton(sim, sim.world.xOf(forge.door) + 0.5, sim.world.yOf(forge.door) + 0.5)
    expect(sim.population().automatons).toBe(1)
    sim.tick = 10 * sim.tpm
    runMonths(sim, 7)
    expect(sim.citizens.has(bot.id)).toBe(true)
    expect(bot.home).toBe(0)
    expect(bot.hunger).toBe(1)
    expect(bot.health).toBe(1)
    expect(bot.wind).toBeGreaterThan(0)
    expect(sim.stats.consumed.coal ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('run down without coal and seize up after their working life', () => {
    const sim = newColony()
    const forge = sim.headquarters()!
    // Colonies start with a little coal; this one has none.
    for (const b of sim.storages()) delete b.stock.coal
    const bot = createAutomaton(sim, sim.world.xOf(forge.door) + 0.5, sim.world.yOf(forge.door) + 0.5)
    runMonths(sim, 7)
    expect(bot.wind).toBe(0)
    bot.age += 16 * 12
    runMonths(sim, 1)
    expect(sim.citizens.has(bot.id)).toBe(false)
    expect(sim.stats.deathsBy.wear).toBe(1)
    expect(sim.stats.deaths).toBe(0)
  })

  it('are assembled at an automaton works from parts', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    const works = besideForge(sim, 'automaton-works')
    Object.assign(forge.stock, { cogs: 12, copper: 8, iron: 20 })
    runMonths(sim, 3)
    expect(works.workers.length).toBeGreaterThan(0)
    expect(sim.population().automatons).toBeGreaterThan(0)
  })
})

describe('steam logistics', () => {
  it('tramways are fast only while a tram depot has steam', () => {
    const sim = newColony()
    const tram = sim.rules.roads.findIndex((r) => r.id === 'tramway')
    runSeconds(sim, 1)
    expect(sim.world.roadSpeeds[tram]).toBe(sim.rules.roads[tram].unpoweredSpeed)
    const forge = sim.headquarters()!
    build(sim, 'tram-depot', forge.x + forge.w, forge.y)
    runSeconds(sim, 2)
    expect(sim.world.roadSpeeds[tram]).toBe(sim.rules.roads[tram].speed)
  })

  it('pneumatic depots on one steam grid share their goods', () => {
    const sim = newColony()
    const forge = sim.headquarters()!
    const a = build(sim, 'pneumatic-depot', forge.x + forge.w, forge.y)
    const b = build(sim, 'pneumatic-depot', forge.x + forge.w + 8, forge.y)
    lay(sim, row(sim, a.x + a.w, b.x - 1, forge.y))
    a.stock.potatoes = 60
    runSeconds(sim, 1)
    balanceDepots(sim)
    expect(b.stock.potatoes ?? 0).toBeGreaterThan(20)
    expect((a.stock.potatoes ?? 0) + (b.stock.potatoes ?? 0)).toBeLessThanOrEqual(60 + 1e-6)
  })

  it('overloaded boilers burst unless a safety valve guards the grid', () => {
    const run = (valve: boolean) => {
      const sim = newColony({ seed: 5 })
      const boiler = besideForge(sim, 'boiler-house')
      if (valve) besideForge(sim, 'safety-valve')
      boiler.stock.coal = 24
      sim.tick = sim.tpm * 12
      runSeconds(sim, 3)
      const steam = networkIndex(sim, 'steam')
      const grid = sim.energy.grids[steam].get(boiler.id)!
      let bursts = 0
      for (let m = 0; m < 24; m++) {
        // Twice as much steam drawn as raised.
        sim.energy.status[steam][grid] = { supply: 40, demand: 80 }
        boiler.fire = 0
        boiler.data.lit = true
        const before = sim.notices.length
        checkPressure(sim)
        bursts += sim.notices.slice(before).filter((n) => n.text.startsWith('Overpressure')).length
      }
      return bursts
    }
    expect(run(false)).toBeGreaterThan(0)
    expect(run(true)).toBe(0)
  })
})

describe('saves', () => {
  it('trade orders, credit and automatons survive a save exactly', () => {
    const original = newColony({ seed: 3, difficulty: 'tinkerer' })
    const forge = original.headquarters()!
    besideForge(original, 'airship-mast')
    original.perform({ type: 'setTrade', res: 'logs', mode: 'export', amount: 40 })
    createAutomaton(original, forge.x, forge.y + forge.h + 1)
    runMonths(original, 2)
    const loaded = Simulation.deserialize(content, original.serialize())
    runMonths(original, 3)
    runMonths(loaded, 3)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
  })
})
