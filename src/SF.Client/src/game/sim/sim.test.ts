import { describe, expect, it } from 'vitest'
import { generateMap } from './mapgen'
import { Simulation } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import { findSpot } from './placement'
import { Terrain } from './types'

function hashOf(sim: Simulation): string {
  return JSON.stringify(sim.serialize())
}

describe('map generation', () => {
  it('is deterministic per seed and leaves a clear founding site', () => {
    const preset = content.bundle.mapgen.terrains[0]
    const a = generateMap(content, 99, 128, preset, 8)
    const b = generateMap(content, 99, 128, preset, 8)
    const c = generateMap(content, 100, 128, preset, 8)
    expect(Array.from(a.world.terrain)).toEqual(Array.from(b.world.terrain))
    expect(Array.from(a.world.feature)).toEqual(Array.from(b.world.feature))
    expect(Array.from(a.world.terrain)).not.toEqual(Array.from(c.world.terrain))
    a.world.forRadius(a.spawnX + 0.5, a.spawnY + 0.5, 8, (i) => {
      expect(a.world.isLand(i)).toBe(true)
      expect(a.world.feature[i]).toBe(0)
    })
  })

  it('places every kind of deposit, water and forest on each terrain preset', () => {
    for (const preset of content.bundle.mapgen.terrains) {
      const { world } = generateMap(content, 7, 160, preset, 8)
      const counts = new Map<number, number>()
      for (const t of world.terrain) counts.set(t, (counts.get(t) ?? 0) + 1)
      expect(counts.get(Terrain.Stone) ?? 0, preset.id).toBeGreaterThan(5)
      expect(counts.get(Terrain.Water) ?? 0, preset.id).toBeGreaterThan(50)
      expect(world.feature.filter((f) => f === 1).length, preset.id).toBeGreaterThan(300)
    }
  })
})

describe('founding', () => {
  it('creates the Steamforge, families and supplies per difficulty', () => {
    for (const preset of content.bundle.difficulty.presets) {
      const sim = newColony({ difficulty: preset.id })
      const defs = [...sim.buildings.values()].map((b) => b.def)
      expect(defs).toContain('steamforge')
      for (const entry of preset.startingBuildings) {
        expect(defs.filter((d) => d === entry.id).length, `${preset.id} ${entry.id}`).toBe(entry.count)
      }
      expect(sim.citizens.size).toBeGreaterThanOrEqual(preset.startingFamilies * 2)
      sim.step()
      for (let i = 0; i < sim.tps; i++) sim.step()
      for (const [res, qty] of Object.entries(preset.startingResources)) {
        expect(sim.totals[res] ?? 0, `${preset.id} ${res}`).toBeCloseTo(qty, 0)
      }
    }
  })

  it('houses families when the difficulty grants cottages', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    expect(sim.population().homeless).toBeLessThan(sim.citizens.size)
  })
})

describe('pause and build', () => {
  it('accepts placement while paused and makes no progress until time runs', () => {
    const sim = newColony()
    const hall = [...sim.buildings.values()].find((b) => b.def === 'steamforge')!
    const spot = findSpot(sim, sim.def('cottage'), hall.x + 2, hall.y + 10)!
    const result = sim.perform({ type: 'place', def: 'cottage', x: spot.x, y: spot.y, rot: 0 })
    expect(result.ok).toBe(true)
    const id = result.ok ? result.building! : 0
    const site = sim.buildings.get(id)!
    expect(site.site).not.toBeNull()
    expect(site.site!.work).toBe(0)
    // Further commands while paused are fine too.
    expect(sim.perform({ type: 'setBuilders', count: 4 }).ok).toBe(true)
    expect(sim.perform({ type: 'prioritise', building: id, priority: true }).ok).toBe(true)
    expect(sim.tick).toBe(0)

    runMonths(sim, 3)
    expect(sim.buildings.get(id)?.site ?? null).toBeNull()
  })

  it('rejects invalid placements with a reason', () => {
    const sim = newColony()
    const hall = [...sim.buildings.values()].find((b) => b.def === 'steamforge')!
    const overlap = sim.perform({ type: 'place', def: 'cottage', x: hall.x, y: hall.y, rot: 0 })
    expect(overlap).toEqual({ ok: false, reason: expect.stringContaining('already built') })
    const quarry = sim.perform({ type: 'place', def: 'quarry', x: hall.x + 6, y: hall.y + 6, rot: 0 })
    expect(quarry.ok).toBe(false)
  })

  it('builds roads and clears marked trees', () => {
    const sim = newColony()
    const hall = [...sim.buildings.values()].find((b) => b.def === 'steamforge')!
    const free = (i: number) => sim.world.walkable(i) && sim.world.building[i] === 0 && sim.world.road[i] === 0 && sim.world.feature[i] === 0
    let tiles: number[] = []
    for (let y = hall.y - 6; y < hall.y + 12 && tiles.length === 0; y++) {
      const row = [0, 1, 2, 3].map((d) => sim.world.index(hall.x + 6 + d, y))
      if (row.every(free)) tiles = row
    }
    expect(tiles.length).toBe(4)
    expect(sim.perform({ type: 'road', road: 'dirt', tiles }).ok).toBe(true)
    // A month is one day: builders down tools at night.
    runMonths(sim, 2)
    for (const t of tiles) expect(sim.world.road[t]).toBeGreaterThan(0)

    const tree = sim.world.feature.findIndex((f, i) => f === sim.featureCode('tree') && sim.world.distance(i, hall.door) < 30)
    expect(tree).toBeGreaterThan(-1)
    sim.perform({ type: 'markClear', tiles: [tree], clear: true })
    runMonths(sim, 1)
    expect(sim.world.feature[tree]).toBe(0)
  })
})

describe('determinism and saves', () => {
  it('two colonies with the same seed and commands stay identical', () => {
    const a = newColony({ seed: 42 })
    const b = newColony({ seed: 42 })
    for (const sim of [a, b]) {
      const hall = [...sim.buildings.values()].find((x) => x.def === 'steamforge')!
      const spot = findSpot(sim, sim.def('foragers-hut'), hall.x, hall.y + 12)!
      sim.perform({ type: 'place', def: 'foragers-hut', x: spot.x, y: spot.y, rot: 0 })
      runMonths(sim, 4)
    }
    expect(hashOf(a)).toBe(hashOf(b))
  })

  it('a saved colony continues exactly as the original', () => {
    const original = newColony({ seed: 7 })
    runMonths(original, 2)
    const loaded = Simulation.deserialize(content, original.serialize())
    expect(hashOf(loaded)).toBe(hashOf(original))
    runMonths(original, 3)
    runMonths(loaded, 3)
    expect(hashOf(loaded)).toBe(hashOf(original))
  })
})

describe('survival', () => {
  it('citizens starve without food', () => {
    const sim = newColony({ difficulty: 'inferno' })
    for (const b of sim.buildings.values()) {
      for (const res of Object.keys(b.stock)) if (sim.resource(res)?.category === 'food') delete b.stock[res]
    }
    runMonths(sim, 14)
    expect(sim.stats.deathsBy.starvation ?? 0).toBeGreaterThan(0)
  })

  it('winter chills anyone outdoors and homes without firewood go cold', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    for (const b of sim.buildings.values()) delete b.stock.firewood
    sim.tick = 10 * sim.tpm
    for (const c of sim.citizens.values()) c.wait = 100000
    runSeconds(sim, 10)
    for (const c of sim.citizens.values()) expect(c.warmth).toBeLessThan(1)
    const homes = [...sim.buildings.values()].filter((b) => b.def === 'cottage' && b.residents.length > 0)
    expect(homes.length).toBeGreaterThan(0)
    for (const h of homes) expect(h.data.heated).toBe(false)
  })

  it('harder difficulties are harsher', () => {
    const easy = newColony({ difficulty: 'tinkerer' })
    const hard = newColony({ difficulty: 'inferno' })
    expect(easy.mods.winterSeverity).toBeLessThan(hard.mods.winterSeverity)
    runSeconds(easy, 1)
    runSeconds(hard, 1)
    const total = (s: Simulation) => Object.values(s.totals).reduce((x, y) => x + y, 0)
    expect(total(easy)).toBeGreaterThan(total(hard))
    // Mid-winter is colder on Brass Inferno.
    easy.tick = hard.tick = 10 * easy.tpm
    expect(hard.temperature).toBeLessThan(easy.temperature)
  })
})
