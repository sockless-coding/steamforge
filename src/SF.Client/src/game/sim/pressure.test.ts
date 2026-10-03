import { describe, expect, it } from 'vitest'
import { decodeArray, encodeArray } from './codec'
import { networkIndex } from './energy'
import { canPlace, footprintSize, placeBuilding } from './placement'
import { Simulation, type ColonySnapshot } from './simulation'
import { content, newColony, runSeconds } from './testing'
import type { Building } from './types'

function build(sim: Simulation, def: string, x: number, y: number): Building {
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const check = canPlace(sim, d, x, y, 0, undefined, undefined, true)
  if (!check.ok) throw new Error(`${def} at ${x},${y}: ${check.reason}`)
  return placeBuilding(sim, d, x, y, 0, w, h, true)
}

/** A finished building on a free spot sharing an edge with another building. */
function beside(sim: Simulation, other: Building, def: string): Building {
  const [w, h] = footprintSize(sim.def(def), 0)
  const spots: [number, number][] = []
  for (let dx = 1 - w; dx < other.w; dx++) spots.push([other.x + dx, other.y - h], [other.x + dx, other.y + other.h])
  for (let dy = 1 - h; dy < other.h; dy++) spots.push([other.x - w, other.y + dy], [other.x + other.w, other.y + dy])
  for (const [x, y] of spots) if (canPlace(sim, sim.def(def), x, y, 0, undefined, undefined, true).ok) return build(sim, def, x, y)
  throw new Error(`no room for ${def} beside ${other.def}`)
}

describe('feedwater', () => {
  it('a boiler house raises steam only with feedwater from a windpump or pump house', () => {
    const sim = newColony({ seed: 5, difficulty: 'engineer' })
    const forge = sim.headquarters()!
    const boiler = beside(sim, forge, 'boiler-house')
    boiler.stock.coal = 24
    runSeconds(sim, 6)
    expect(boiler.workers.length).toBeGreaterThan(0)
    expect(boiler.data.lit).toBe(true)
    const steam = networkIndex(sim, 'steam')
    const dry = sim.energy.totals[steam].supply
    // Only the Steamforge's 12 psi: the boiler has no water.
    expect(dry).toBeCloseTo(12, 5)
    beside(sim, boiler, 'windpump')
    runSeconds(sim, 3)
    const wet = sim.energy.totals[steam].supply
    // A windpump lifts 12 gallons against the boiler's 12: full output.
    expect(wet).toBeCloseTo(12 + 40, 5)
  })
})

describe('steam heating', () => {
  it('homes on a main burn less firewood than homes off the grid', () => {
    const burned = (onMain: boolean) => {
      const sim = newColony({ seed: 9, difficulty: 'tinkerer' })
      const forge = sim.headquarters()!
      const steam = networkIndex(sim, 'steam')
      if (!onMain) {
        // Cut the cottages off: no conduits, and keep them clear of the Steamforge's walls.
        for (let i = 0; i < sim.world.size; i++) sim.world.conduit[i] &= ~(1 << steam)
      }
      const homes = [...sim.buildings.values()].filter((b) => b.def === 'cottage')
      for (const h of homes) {
        h.stock.firewood = 20
        if (onMain) {
          for (let x = Math.min(h.x, forge.x); x <= Math.max(h.x, forge.x + forge.w); x++) {
            const i = sim.world.index(x, h.y)
            if (sim.world.building[i] === 0 && sim.world.isLand(i)) sim.world.conduit[i] |= 1 << steam
          }
          for (let y = Math.min(h.y, forge.y); y <= Math.max(h.y, forge.y + forge.h); y++) {
            const i = sim.world.index(forge.x + forge.w, y)
            if (sim.world.building[i] === 0 && sim.world.isLand(i)) sim.world.conduit[i] |= 1 << steam
          }
        }
      }
      sim.energy.dirty = true
      sim.tick = 10 * sim.tpm
      const before = sim.stats.consumed.firewood ?? 0
      runSeconds(sim, 30)
      return { burned: (sim.stats.consumed.firewood ?? 0) - before, heat: homes.reduce((s, h) => s + ((h.data.heat as number) ?? 0), 0) }
    }
    const off = burned(false)
    const on = burned(true)
    expect(on.heat).toBeGreaterThan(0)
    expect(on.burned).toBeLessThan(off.burned)
  })
})

describe('steam tractors', () => {
  it('speed up planting on fields within reach while the shed has steam', () => {
    const sim = newColony({ seed: 4, difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    const shed = beside(sim, forge, 'tractor-shed')
    const d = sim.def('crop-field')
    let field: Building | null = null
    for (let dy = 4; dy < 14 && !field; dy++) {
      for (let dx = -8; dx < 8 && !field; dx++) {
        const x = shed.x + dx
        const y = shed.y + shed.h + dy
        if (canPlace(sim, d, x, y, 0, 6, 6, true).ok) field = placeBuilding(sim, d, x, y, 0, 6, 6, true)
      }
    }
    expect(field).not.toBeNull()
    runSeconds(sim, 3)
    expect(shed.data.power as number).toBeGreaterThan(0)
    expect(field!.data.tractor as number).toBeGreaterThan(0)
  })
})

describe('version 5 saves', () => {
  it('remap conduits, pull down forager huts and turn berries into rations', () => {
    const sim = newColony({ seed: 21, difficulty: 'tinkerer' })
    const forge = sim.headquarters()!
    const steam = networkIndex(sim, 'steam')
    const pipe = [sim.world.index(forge.x + forge.w, forge.y), sim.world.index(forge.x + forge.w + 1, forge.y)]
    const s = JSON.parse(JSON.stringify(sim.serialize())) as ColonySnapshot
    // Rewrite the snapshot as version 5 would have stored it.
    s.v = 5
    const conduit = new Uint8Array(sim.world.size)
    for (const t of pipe) conduit[t] = 1 // steam was network 0
    s.world.conduit = encodeArray(conduit)
    delete s.world.grades
    const features = decodeArray(s.world.feature, Uint8Array)
    const bush = features.findIndex((f) => f === 0)
    features[bush] = 4 // berries were feature 4
    s.world.feature = encodeArray(features)
    const hq = s.buildings.find((b) => b.id === forge.id)!
    hq.stock.berries = 30
    const rationsBefore = hq.stock.rations ?? 0
    const template = s.buildings.find((b) => b.def === 'cottage')!
    const hut = { ...JSON.parse(JSON.stringify(template)), id: 9001, def: 'foragers-hut', residents: [], workers: [], stock: { berries: 5 } }
    s.buildings.push(hut)
    const worker = s.citizens.find((c) => c.age >= 20 * 12)!
    worker.workplace = 9001
    worker.profession = 'forager'
    hut.workers = [worker.id]
    worker.diet = ['berries', 'potatoes']
    s.research.done.push('engines', 'glasshouse')

    const loaded = Simulation.deserialize(content, s)
    for (const t of pipe) {
      expect(loaded.world.conduit[t]).toBe(1 << steam)
      expect(loaded.world.gradeOf(steam, t)).toBe(1)
    }
    expect(loaded.buildings.has(9001)).toBe(false)
    const w = loaded.citizens.get(worker.id)!
    expect(w.workplace).toBe(0)
    expect(w.profession).toBe('laborer')
    expect(w.diet).toEqual(['potatoes'])
    expect(loaded.world.feature[bush]).toBe(0)
    const newHq = loaded.headquarters()!
    expect(newHq.stock.berries).toBeUndefined()
    expect(newHq.stock.rations).toBeCloseTo(rationsBefore + 35, 5)
    expect(loaded.research.done).toContain('hydraulics')
    expect(loaded.research.done).not.toContain('glasshouse')
    runSeconds(loaded, 30)
  })
})
