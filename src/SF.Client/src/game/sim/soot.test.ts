import { describe, expect, it } from 'vitest'
import { runEffect } from './effects'
import { eventHandler } from './events'
import { addStock } from './inventory'
import { canPlace, findSpot, footprintSize, placeBuilding } from './placement'
import { Simulation } from './simulation'
import { setWind, SootField, updateSoot } from './soot'
import { content, newColony, runSeconds } from './testing'
import type { Building } from './types'

function build(sim: Simulation, def: string, near?: [number, number]): Building {
  const d = sim.def(def)
  const hq = sim.headquarters()!
  const [cx, cy] = near ?? [hq.x + 2, hq.y + 2]
  const spot = findSpot(sim, d, cx, cy, 40, true)
  if (!spot) throw new Error(`no room for ${def}`)
  const [w, h] = footprintSize(d, 0)
  expect(canPlace(sim, d, spot.x, spot.y, 0, undefined, undefined, true).ok).toBe(true)
  return placeBuilding(sim, d, spot.x, spot.y, 0, w, h, true)
}

function centre(b: Building): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2]
}

/** Holds the air at a fixed level of soot everywhere (the wind and the weather are stilled). */
function smother(sim: Simulation, level: number): void {
  setWind(sim, 0, 0)
  sim.soot.soot.fill(level)
}

function people(sim: Simulation) {
  return [...sim.citizens.values()].filter((c) => !c.automaton)
}

function meanHealth(sim: Simulation): number {
  const list = people(sim)
  return list.reduce((s, c) => s + c.health, 0) / list.length
}

describe('the soot field', () => {
  it('carries soot downwind and leaves the upwind side clean', () => {
    const f = new SootField(64, 64, 4)
    for (let s = 0; s < 30; s++) {
      f.add(32, 32, 5)
      // Wind blowing towards +x at one tile per second.
      f.step(1, 0, 0.05, 0.006, 0, 0.002)
    }
    const at = (x: number) => f.soot[f.cellAt(x, 32)]
    expect(at(44)).toBeGreaterThan(at(20) * 5)
    expect(at(20)).toBeLessThan(0.5)
  })

  it('forest cover thins the smoke', () => {
    const open = new SootField(64, 64, 4)
    const wooded = new SootField(64, 64, 4)
    wooded.forest.fill(1)
    for (let s = 0; s < 60; s++) {
      for (const f of [open, wooded]) {
        f.add(32, 32, 5)
        f.step(0.5, 0, 0.05, 0.006, 0.03, 0.002)
      }
    }
    expect(wooded.total()).toBeLessThan(open.total() * 0.7)
  })

  it('settles as grime that fades month by month', () => {
    const sim = newColony({ seed: 3 })
    smother(sim, 40)
    runSeconds(sim, 20)
    const grime = sim.soot.grime.reduce((s, v) => s + v, 0)
    expect(grime).toBeGreaterThan(0)
  })
})

describe('chimneys', () => {
  it('a working smelter smokes, and its tall stack lays the soot down downwind', () => {
    const sim = newColony({ seed: 7, difficulty: 'tinkerer' })
    const smelter = build(sim, 'smelter')
    sim.soot.soot.fill(0)
    setWind(sim, 270, 0.6) // from the west: soot drifts east (+x)
    for (let s = 0; s < 40; s++) {
      smelter.activeAt = sim.second
      updateSoot(sim)
    }
    const [x, y] = centre(smelter)
    const east = sim.soot.soot[sim.soot.cellAt(x + 8, y)]
    const west = sim.soot.soot[sim.soot.cellAt(x - 8, y)]
    expect(east).toBeGreaterThan(1)
    expect(east).toBeGreaterThan(west * 4)
  })

  it('an idle workshop does not smoke', () => {
    const sim = newColony({ seed: 7, difficulty: 'tinkerer' })
    const smelter = build(sim, 'smelter')
    smelter.activeAt = -100
    sim.soot.soot.fill(0)
    setWind(sim, 270, 0.6)
    const [x, y] = centre(smelter)
    for (let s = 0; s < 20; s++) updateSoot(sim)
    expect(sim.soot.soot[sim.soot.cellAt(x, y)]).toBeLessThan(0.5)
  })

  it('home stoves burning firewood in the cold add smoke at street level', () => {
    const sim = newColony({ seed: 7, difficulty: 'tinkerer' })
    sim.weather.snapDegrees = -30
    sim.weather.snapMonths = 6
    const homes = [...sim.buildings.values()].filter((b) => b.def === 'cottage' && b.residents.length > 0)
    for (const b of homes) addStock(b.stock, 'firewood', 5)
    runSeconds(sim, 2)
    expect(homes.some((b) => ((b.data.burn as number) ?? 0) > 0)).toBe(true)
  })

  it('soot scales with difficulty', () => {
    expect(content.presets.get('inferno')!.modifiers.sootRate).toBeGreaterThan(content.presets.get('tinkerer')!.modifiers.sootRate)
  })
})

describe('soot and people', () => {
  it('breathing heavy smoke wears down health, harder for children and elders', () => {
    const clean = newColony({ seed: 9, difficulty: 'tinkerer' })
    const sooty = newColony({ seed: 9, difficulty: 'tinkerer' })
    for (let s = 0; s < 6; s++) {
      setWind(clean, 0, 0)
      clean.soot.soot.fill(0)
      smother(sooty, sooty.rules.soot.fullSoot * 2)
      runSeconds(clean, 10)
      runSeconds(sooty, 10)
    }
    expect(meanHealth(sooty)).toBeLessThan(meanHealth(clean) - 0.03)
    const r = sooty.rules.citizen
    const adults = people(sooty).filter((c) => c.age >= r.adultAge * 12 && c.age < r.elderAge * 12)
    const children = people(sooty).filter((c) => c.age < r.adultAge * 12)
    if (children.length && adults.length) {
      const avg = (list: typeof adults) => list.reduce((s, c) => s + c.health, 0) / list.length
      expect(avg(children)).toBeLessThan(avg(adults))
    }
  })

  it('an apothecary supplied with tonic shields the homes around it', () => {
    const plain = newColony({ seed: 9, difficulty: 'tinkerer' })
    const tended = newColony({ seed: 9, difficulty: 'tinkerer' })
    // The apothecary doses the homes in reach as soon as it opens, if there is tonic in storage.
    addStock(tended.headquarters()!.stock, 'tonic', 50)
    for (const sim of [plain, tended]) build(sim, 'apothecary')
    const apothecary = [...tended.buildings.values()].find((b) => b.def === 'apothecary')!
    expect(apothecary.data.dosed).toBeGreaterThan(0.99)
    const housed = (sim: Simulation) => people(sim).filter((c) => c.home)
    for (let s = 0; s < 6; s++) {
      for (const sim of [plain, tended]) {
        smother(sim, sim.rules.soot.fullSoot * 2)
        runSeconds(sim, 10)
      }
    }
    const lost = (sim: Simulation) => housed(sim).reduce((s, c) => s + (1 - c.health), 0)
    expect(lost(tended)).toBeLessThan(lost(plain) * 0.7)
  })

  it('smoky streets are unhappy streets', () => {
    const clean = newColony({ seed: 9, difficulty: 'tinkerer' })
    const sooty = newColony({ seed: 9, difficulty: 'tinkerer' })
    for (let s = 0; s < 12; s++) {
      setWind(clean, 0, 0)
      clean.soot.soot.fill(0)
      smother(sooty, sooty.rules.soot.fullSoot)
      runSeconds(clean, 10)
      runSeconds(sooty, 10)
    }
    const mood = (sim: Simulation) => people(sim).reduce((s, c) => s + c.happiness, 0)
    expect(mood(sooty)).toBeLessThan(mood(clean))
  })
})

describe('soot and the land', () => {
  it('grime on the soil cuts the harvest', () => {
    const yieldOf = (grime: number) => {
      const sim = newColony({ seed: 4, difficulty: 'tinkerer' })
      const field = build(sim, 'crop-field')
      sim.soot.grime.fill(grime)
      field.data.phase = 'harvest'
      ;(field.data.plots as number[])[0] = 1
      runEffect('harvestPlot', sim, people(sim)[0], [field.id, 0])
      return Object.values(field.stock).reduce((s, v) => s + v, 0)
    }
    const clean = yieldOf(0)
    const fouled = yieldOf(content.bundle.rules.soot.fullGrime)
    expect(clean).toBeGreaterThan(0)
    expect(fouled).toBeCloseTo(clean * (1 - content.bundle.rules.soot.cropPenalty))
  })

  it('a powered precipitator clears the air around it', () => {
    const sim = newColony({ seed: 4, difficulty: 'tinkerer' })
    const p = build(sim, 'galvanic-precipitator')
    smother(sim, 10)
    p.data.power = 1
    updateSoot(sim)
    const [x, y] = centre(p)
    expect(sim.soot.soot[sim.soot.cellAt(x, y)]).toBeLessThan(9)
    expect(sim.soot.soot[sim.soot.cellAt(x + 40, y)]).toBeGreaterThan(9)
    p.data.power = 0
    smother(sim, 10)
    updateSoot(sim)
    expect(sim.soot.soot[sim.soot.cellAt(x, y)]).toBeGreaterThan(9)
  })

  it('rain washes the air and the streets', () => {
    const sim = newColony({ seed: 4 })
    sim.soot.soot.fill(20)
    sim.soot.grime.fill(30)
    const def = sim.content.bundle.events.find((e) => e.kind === 'rain')!
    expect(eventHandler('rain')!.run(sim, def)).toBe(true)
    expect(sim.soot.soot[0]).toBeLessThan(10)
    expect(sim.soot.grime[0]).toBeLessThan(30)
    sim.soot.soot.fill(0)
    sim.soot.grime.fill(0)
    expect(eventHandler('rain')!.run(sim, def)).toBe(false)
  })

  it('black lung only strikes where the air is foul', () => {
    const sim = newColony({ seed: 4, difficulty: 'tinkerer' })
    const def = sim.content.bundle.events.find((e) => e.kind === 'blackLung')!
    sim.soot.soot.fill(0)
    expect(eventHandler('blackLung')!.run(sim, def)).toBe(false)
    sim.soot.soot.fill(sim.rules.soot.fullSoot)
    expect(eventHandler('blackLung')!.run(sim, def)).toBe(true)
    expect(people(sim).some((c) => c.sick > 0)).toBe(true)
  })
})

describe('soot and saves', () => {
  it('a saved colony keeps its soot, grime and wind and continues exactly', () => {
    const original = newColony({ seed: 21, difficulty: 'tinkerer' })
    build(original, 'smelter')
    original.soot.soot.fill(3)
    original.soot.grime.fill(5)
    runSeconds(original, 200)
    const loaded = Simulation.deserialize(content, original.serialize())
    expect(Array.from(loaded.soot.soot)).toEqual(Array.from(original.soot.soot))
    runSeconds(original, 400)
    runSeconds(loaded, 400)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
  })

  it('migrates version 4 saves to clean skies and a prevailing wind', () => {
    const sim = newColony({ seed: 21 })
    const snap = JSON.parse(JSON.stringify(sim.serialize()))
    snap.v = 4
    delete snap.soot
    delete snap.weather.windX
    delete snap.weather.windY
    const loaded = Simulation.deserialize(content, snap)
    expect(loaded.soot.total()).toBe(0)
    expect(Math.hypot(loaded.weather.windX, loaded.weather.windY)).toBeGreaterThan(0)
    runSeconds(loaded, 30)
  })
})
