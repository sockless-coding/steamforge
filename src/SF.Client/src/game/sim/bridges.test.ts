import { describe, expect, it } from 'vitest'
import { Simulation } from './simulation'
import { newColony, runMonths } from './testing'
import { TERRAIN_IDS } from './types'

/** Floods a three-tile-wide river from the top of the map to the bottom, east of the Steamforge. */
function carveRiver(sim: Simulation): number {
  const world = sim.world
  const forge = sim.headquarters()!
  let x0 = forge.x + forge.w + 4
  const clear = (x: number) => {
    for (let y = 0; y < world.height; y++) if (world.building[world.index(x, y)] !== 0) return false
    return true
  }
  while (!(clear(x0) && clear(x0 + 1) && clear(x0 + 2))) x0++
  for (let y = 0; y < world.height; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      const i = world.index(x, y)
      world.terrain[i] = TERRAIN_IDS.water
      world.road[i] = 0
      world.feature[i] = 0
    }
  }
  world.version++
  return x0
}

describe('bridges', () => {
  it('a trestle bridge lets citizens cross a river that blocks them otherwise', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const world = sim.world
    const forge = sim.headquarters()!
    const x0 = carveRiver(sim)
    const y = forge.door === -1 ? forge.y : world.yOf(forge.door)
    const west = world.index(x0 - 1, y)
    const east = world.index(x0 + 3, y)
    // Make sure both banks are dry and free.
    for (const i of [west, east]) {
      world.terrain[i] = TERRAIN_IDS.grass
      world.feature[i] = 0
    }
    expect(sim.path.find(west, east)).toBeNull()

    const span = [west, world.index(x0, y), world.index(x0 + 1, y), world.index(x0 + 2, y), east]
    const dirt = sim.perform({ type: 'road', road: 'dirt', tiles: span.slice(1, 4) })
    expect(dirt.ok).toBe(false)
    if (!dirt.ok) expect(dirt.reason).toMatch(/bridge/)

    // Dragged bank to bank: only the three water tiles are ordered.
    expect(sim.perform({ type: 'road', road: 'bridge', tiles: span }).ok).toBe(true)
    expect([...sim.roadJobs.keys()].sort((a, b) => a - b)).toEqual(span.slice(1, 4))

    runMonths(sim, 3)
    expect(sim.roadJobs.size).toBe(0)
    for (const i of span.slice(1, 4)) expect(world.isBridge(i)).toBe(true)
    expect(sim.path.find(west, east)).not.toBeNull()

    // A walker left on a deck that is pulled down scrambles to dry footing.
    const c = [...sim.citizens.values()].find((x) => !x.inside)!
    c.x = c.px = x0 + 1.5
    c.y = c.py = y + 0.5
    sim.perform({ type: 'removeRoad', tiles: [world.index(x0 + 1, y)] })
    expect(world.walkable(world.index(Math.floor(c.x), Math.floor(c.y)))).toBe(true)
    expect(sim.path.find(west, east)).toBeNull()
  })

  it('bridges only go over water within reach of the shore, and survive a save', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    const world = sim.world
    const forge = sim.headquarters()!
    // A broad lake: its middle is more than three tiles from any bank.
    const cx = forge.x + forge.w + 12
    const cy = forge.y
    for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) world.terrain[world.index(x, y)] = TERRAIN_IDS.water
    world.version++
    const middle = sim.perform({ type: 'road', road: 'bridge', tiles: [world.index(cx, cy)] })
    expect(middle.ok).toBe(false)
    if (!middle.ok) expect(middle.reason).toMatch(/shore/)
    const land = sim.perform({ type: 'road', road: 'bridge', tiles: [forge.door] })
    expect(land.ok).toBe(false)

    const shore = world.index(cx - 6, cy)
    world.road[shore] = sim.rules.roads.findIndex((r) => r.bridge) + 1
    world.version++
    expect(world.walkable(shore)).toBe(true)
    const copy = Simulation.deserialize(sim.content, sim.serialize())
    expect(copy.world.walkable(shore)).toBe(true)
  })
})
