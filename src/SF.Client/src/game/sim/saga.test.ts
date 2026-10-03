import { describe, expect, it } from 'vitest'
import { indexContent, type Content } from '../../api/content'
import { networkIndex } from './energy'
import { guildState } from './guilds'
import { canPlace, footprintSize, placeBuilding } from './placement'
import { chart, finaleBlocker, hqOutputFactor, relicFactor, telegraphOnline, updateSaga, voyageMonths } from './saga'
import { Simulation, type ColonySnapshot } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

/** Content whose voyages are never dangerous, so expedition outcomes are certain. */
const safe: Content = indexContent({
  ...content.bundle,
  forges: { ...content.bundle.forges, fates: content.bundle.forges.fates.map((f) => ({ ...f, danger: 0 })) },
})

function colony(c: Content = content, difficulty = 'tinkerer'): Simulation {
  return Simulation.create(c, { seed: 31, name: 'Hollowfield', difficulty, mapSize: 'small', terrain: 'valley' })
}

/** A finished building against the Steamforge's walls (so it shares its steam). */
function besideForge(sim: Simulation, def: string): Building {
  const forge = sim.headquarters()!
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const spots: [number, number][] = []
  for (let dx = 1 - w; dx < forge.w; dx++) spots.push([forge.x + dx, forge.y - h], [forge.x + dx, forge.y + forge.h])
  for (let dy = 1 - h; dy < forge.h; dy++) spots.push([forge.x - w, forge.y + dy], [forge.x + forge.w, forge.y + dy])
  for (const [x, y] of spots) if (canPlace(sim, d, x, y, 0, undefined, undefined, true).ok) return placeBuilding(sim, d, x, y, 0, w, h, true)
  throw new Error(`no room for ${def}`)
}

function stockUp(sim: Simulation): void {
  Object.assign(sim.headquarters()!.stock, { cogs: 40, copper: 40, envelope: 20, coal: 120, tonic: 30, iron: 60 })
  runSeconds(sim, 1)
}

describe('the Hollowmere chart', () => {
  it('places every forge by the colony seed, within its league range', () => {
    const a = colony()
    const b = colony()
    expect(chart(a)).toEqual(chart(b))
    for (const p of chart(a)) {
      const def = a.content.forges.get(p.id)!
      expect(p.leagues).toBeGreaterThanOrEqual(def.leagues[0])
      expect(p.leagues).toBeLessThanOrEqual(def.leagues[1])
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1)
      expect(voyageMonths(a, p.id)).toBe(Math.ceil(p.leagues / a.content.bundle.forges.chart.leaguesPerMonth))
    }
    const other = Simulation.create(content, { seed: 32, name: 'Elsewhere', difficulty: 'tinkerer', mapSize: 'small', terrain: 'valley' })
    expect(chart(other)).not.toEqual(chart(a))
  })
})

describe('acts', () => {
  it('Act II begins with a telegraph office (or by year 4), Act III with the creep papers (or by year 12)', () => {
    const sim = colony()
    updateSaga(sim)
    expect(sim.saga.act).toBe(1)
    besideForge(sim, 'telegraph-office')
    expect(telegraphOnline(sim)).toBe(true)
    updateSaga(sim)
    expect(sim.saga.act).toBe(2)
    expect(sim.story.sent).toContain('act-2')
    for (const p of sim.content.bundle.forges.saga.creepPapers) sim.story.sent.push(p)
    updateSaga(sim)
    expect(sim.saga.act).toBe(3)
    expect(sim.saga.finale).toBe('pending')
    expect(sim.story.sent).toContain('act-3')
    // Brassmoor's boasting stops mid-telegram.
    expect(sim.saga.forges['forge-5'].fate).toBe('overpressure')
    expect(sim.story.sent).toContain('telegram-brassmoor-silence')
  })
})

describe('the telegraph', () => {
  it('greets, asks, pays for help, and falls silent when let down', () => {
    const sim = colony()
    besideForge(sim, 'telegraph-office')
    stockUp(sim)
    updateSaga(sim)
    expect(sim.story.sent).toContain('telegram-saltmarsh')
    const saltmarsh = sim.saga.forges['forge-3']
    saltmarsh.nextRequest = 0
    updateSaga(sim)
    expect(saltmarsh.request?.id).toBe('saltmarsh-tonic')
    const relation = saltmarsh.relation!
    const copper = sim.totals.copper ?? 0
    expect(sim.perform({ type: 'fulfilRequest', forge: 'forge-3' }).ok).toBe(true)
    runSeconds(sim, 1)
    expect(sim.totals.copper ?? 0).toBeGreaterThan(copper)
    expect(saltmarsh.relation!).toBeGreaterThan(relation)
    expect(saltmarsh.request).toBeNull()
    // Frostgate asks and is ignored until it gives up.
    const frostgate = sim.saga.forges['forge-7']
    frostgate.relation = 10
    frostgate.request = { id: 'frostgate-coal', expires: sim.monthIndex }
    updateSaga(sim)
    expect(frostgate.fate).toBe('frozen')
    expect(frostgate.revealed).toBe(false)
  })
})

describe('expeditions', () => {
  it('cannot leave without a working yard, or for a forge that still answers', () => {
    const sim = colony(safe)
    stockUp(sim)
    expect(sim.perform({ type: 'launchExpedition', forge: 'forge-2', crew: 3 }).ok).toBe(false)
    besideForge(sim, 'airship-yard')
    runSeconds(sim, 2)
    expect(sim.perform({ type: 'launchExpedition', forge: 'forge-3', crew: 3 }).ok).toBe(false)
    expect(sim.perform({ type: 'launchExpedition', forge: 'forge-2', crew: 9 }).ok).toBe(false)
  })

  it('a crew leaves the map, reaches a silent forge, and comes home with its papers, plans and salvage', () => {
    const sim = colony(safe)
    besideForge(sim, 'airship-yard')
    stockUp(sim)
    runSeconds(sim, 2)
    const people = sim.citizens.size
    const iron = sim.totals.iron ?? 0
    const result = sim.perform({ type: 'launchExpedition', forge: 'forge-2', crew: 3 })
    expect(result).toEqual({ ok: true })
    expect(sim.citizens.size).toBe(people - 3)
    const exp = sim.saga.expeditions[0]
    expect(exp.crew.length).toBe(3)
    // A save mid-voyage keeps the crew.
    const loaded = Simulation.deserialize(safe, sim.serialize())
    expect(loaded.saga.expeditions[0].crew.map((c) => c.id)).toEqual(exp.crew.map((c) => c.id))
    runMonths(sim, voyageMonths(sim, 'forge-2') * 2 + 1)
    expect(sim.saga.expeditions.length).toBe(0)
    for (const c of exp.crew) expect(sim.citizens.has(c.id)).toBe(true)
    expect(sim.saga.forges['forge-2'].visited).toBe(true)
    expect(sim.saga.forges['forge-2'].revealed).toBe(true)
    expect(sim.research.done).toContain('forge-core-retrofit')
    expect(sim.story.sent).toContain('papers-cinderholm')
    expect(sim.totals.iron ?? 0).toBeGreaterThan(iron - 5)
    expect(sim.stats.produced.iron ?? 0).toBeGreaterThanOrEqual(0)
  })

  it('a relic changes the colony', () => {
    const sim = colony(safe)
    const cold = () => {
      sim.weather.offset = 0
      sim.tick = 10 * sim.tpm
      return sim.temperature
    }
    const before = cold()
    sim.saga.relics.push('frost-charts')
    expect(relicFactor(sim, 'winterSeverity')).toBeCloseTo(0.85, 5)
    expect(cold()).toBeGreaterThan(before)
    sim.saga.relics.push('governor')
    expect(hqOutputFactor(sim)).toBeCloseTo(1.35, 5)
  })
})

describe('the creeping core', () => {
  it('raises free steam, warns, and ruptures if left alone', () => {
    const sim = colony()
    sim.saga.act = 3
    sim.saga.finale = 'pending'
    runSeconds(sim, 2)
    const steam = networkIndex(sim, 'steam')
    const base = sim.energy.totals[steam].supply
    sim.saga.creep = 0.5
    runSeconds(sim, 2)
    expect(sim.energy.totals[steam].supply).toBeGreaterThan(base * 1.3)
    sim.saga.creep = 0.99
    updateSaga(sim)
    expect(sim.saga.finale).toBe('ruptured')
    expect(sim.story.sent).toContain('epilogue-ruptured')
    runSeconds(sim, 2)
    expect(sim.headquarters()!.data.lit).toBe(false)
  })

  it('a safety valve on the Steamforge grid slows the creep', () => {
    const rate = (valve: boolean) => {
      const sim = colony()
      if (valve) besideForge(sim, 'safety-valve')
      runSeconds(sim, 2)
      sim.saga.act = 3
      sim.saga.finale = 'pending'
      updateSaga(sim)
      return sim.saga.creep
    }
    expect(rate(true)).toBeCloseTo(rate(false) * content.bundle.forges.saga.creep.valveFactor, 5)
  })

  it('a retrofit needs the plans and the Institute, takes the Steamforge offline, and doubles it', () => {
    const sim = colony()
    sim.saga.act = 3
    sim.saga.finale = 'pending'
    expect(finaleBlocker(sim, 'retrofit')).toMatch(/plans/)
    sim.research.done.push('forge-core-retrofit')
    guildState(sim, 'institute').standing = 20
    expect(finaleBlocker(sim, 'retrofit')).toMatch(/Institute/)
    guildState(sim, 'institute').standing = 80
    guildState(sim, 'brotherhood').standing = 80
    expect(sim.perform({ type: 'finale', choice: 'retrofit' }).ok).toBe(true)
    expect(hqOutputFactor(sim)).toBe(0)
    runSeconds(sim, 2)
    expect(sim.headquarters()!.data.lit).toBe(false)
    for (let m = 0; m < content.bundle.forges.saga.creep.retrofitMonths + 1; m++) {
      guildState(sim, 'brotherhood').standing = 80
      runMonths(sim, 1)
    }
    expect(sim.saga.finale).toBe('retrofitted')
    expect(hqOutputFactor(sim)).toBeCloseTo(content.bundle.forges.saga.creep.retrofitOutput, 5)
    expect(sim.story.sent).toContain('epilogue-retrofitted')
  })

  it('venting seals the Steamforge cold for good and pleases the Brotherhood', () => {
    const sim = colony()
    sim.saga.act = 3
    sim.saga.finale = 'pending'
    const brotherhood = guildState(sim, 'brotherhood').standing
    expect(sim.perform({ type: 'finale', choice: 'vent' }).ok).toBe(true)
    expect(sim.saga.finale).toBe('decommissioned')
    expect(guildState(sim, 'brotherhood').standing).toBeGreaterThan(brotherhood)
    expect(hqOutputFactor(sim)).toBe(0)
  })
})

describe('saga saves', () => {
  it('version 7 saves start the saga at Act I', () => {
    const sim = newColony({ seed: 5 })
    const s = JSON.parse(JSON.stringify(sim.serialize())) as ColonySnapshot
    s.v = 7
    delete (s as Partial<ColonySnapshot>).saga
    const loaded = Simulation.deserialize(content, s)
    expect(loaded.saga.act).toBe(1)
    expect(Object.keys(loaded.saga.forges).length).toBe(content.bundle.forges.forges.length)
    runSeconds(loaded, 10)
  })

  it('a colony with an expedition away continues exactly after a save', () => {
    const original = colony(safe)
    besideForge(original, 'airship-yard')
    stockUp(original)
    runSeconds(original, 2)
    expect(original.perform({ type: 'launchExpedition', forge: 'forge-6', crew: 2 }).ok).toBe(true)
    runMonths(original, 1)
    const loaded = Simulation.deserialize(safe, original.serialize())
    runMonths(original, 6)
    runMonths(loaded, 6)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
  })
})
