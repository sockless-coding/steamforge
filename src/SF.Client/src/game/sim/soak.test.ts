import { describe, expect, it } from 'vitest'
import { footprintSize, findSpot } from './placement'
import type { Simulation } from './simulation'
import { newColony, runMonths } from './testing'

/** A simple scripted player: places a Banished-style opening build order, then adds homes and food as it grows. */
function place(sim: Simulation, def: string, near: [number, number], w?: number, h?: number): boolean {
  const d = sim.def(def)
  const spot = findSpot(sim, w && h ? { ...d, size: [w, h] } : d, near[0], near[1], 60)
  if (!spot) return false
  const [fw, fh] = footprintSize(d, 0, w, h)
  return sim.perform({ type: 'place', def, x: spot.x, y: spot.y, rot: 0, w: fw, h: fh }).ok
}

function count(sim: Simulation, def: string): number {
  return [...sim.buildings.values()].filter((b) => b.def === def).length
}

function summary(sim: Simulation): string {
  const t = sim.totals
  const food = sim.content.bundle.resources.filter((r) => r.category === 'food').reduce((s, r) => s + (t[r.id] ?? 0), 0)
  const p = sim.population()
  return `y${sim.year} m${sim.month} pop ${p.total} (a${p.adults} c${p.children} e${p.elders} homeless ${p.homeless}) food ${Math.round(food)} wood ${Math.round(t.firewood ?? 0)} logs ${Math.round(t.logs ?? 0)} stone ${Math.round(t.stone ?? 0)} tools ${Math.round(t.tools ?? 0)} deaths ${JSON.stringify(sim.stats.deathsBy)} births ${sim.stats.births} buildings ${sim.buildings.size}
   produced ${JSON.stringify(Object.fromEntries(Object.entries(sim.stats.produced).map(([k, v]) => [k, Math.round(v)])))}
   consumed ${JSON.stringify(Object.fromEntries(Object.entries(sim.stats.consumed).map(([k, v]) => [k, Math.round(v)])))}`
}

function playYear(sim: Simulation, hall: [number, number]): void {
  const pop = sim.citizens.size
  const houses = count(sim, 'cottage') + count(sim, 'rowhouse')
  const families = Math.ceil(pop / 4)
  for (let i = houses; i < families + 1; i++) place(sim, 'cottage', hall)
  if (count(sim, 'crop-field') < Math.ceil(pop / 10)) place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
  if (count(sim, 'foragers-hut') < Math.ceil(pop / 25)) place(sim, 'foragers-hut', [hall[0] - 14, hall[1]])
  if (count(sim, 'woodcutters-shed') < Math.ceil(pop / 25)) place(sim, 'woodcutters-shed', hall)
  if (count(sim, 'quarry') === 0) place(sim, 'quarry', hall)
  if (sim.year >= 2 && count(sim, 'warehouse') === 0) place(sim, 'warehouse', hall)
  if (sim.year >= 2 && count(sim, 'well') === 0) place(sim, 'well', hall)
  if (sim.year >= 3 && count(sim, 'toolworks') === 0) place(sim, 'toolworks', hall)
  sim.perform({ type: 'setBuilders', count: Math.max(3, Math.round(pop / 6)) })
  staff(sim)
}

/** Keeps wood production lean so food gets the hands, as a player would on the Guildhall panel. */
function staff(sim: Simulation): void {
  const caps: Record<string, number> = { 'foresters-lodge': 2, 'woodcutters-shed': 1, quarry: 2, toolworks: 1 }
  for (const b of sim.buildings.values()) {
    const cap = caps[b.def]
    if (cap !== undefined) sim.perform({ type: 'setWorkers', building: b.id, count: cap })
  }
}

describe('soak', () => {
  it('an Engineer colony with a sensible build order survives ten years', () => {
    const sim = newColony({ seed: 2024, mapSize: 'medium' })
    const hallB = [...sim.buildings.values()].find((b) => b.def === 'guildhall')!
    const hall: [number, number] = [hallB.x + 2, hallB.y + 2]
    // Clear the land around the Guildhall for logs and stone, as a Banished player would.
    const clear: number[] = []
    const tree = sim.featureCode('tree')
    const rock = sim.featureCode('rock')
    sim.world.forRadius(hall[0], hall[1], 16, (i) => {
      if (sim.world.feature[i] === tree || sim.world.feature[i] === rock) clear.push(i)
    })
    sim.perform({ type: 'markClear', tiles: clear, clear: true })
    for (const def of ['foragers-hut', 'cottage', 'cottage', 'foresters-lodge', 'woodcutters-shed', 'hunters-lodge', 'cottage']) {
      place(sim, def, hall)
    }
    place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
    const started = Date.now()
    for (let year = 0; year < 10 && sim.outcome === 'playing'; year++) {
      playYear(sim, hall)
      for (let q = 0; q < 4; q++) {
        runMonths(sim, 3)
        staff(sim)
      }
      console.log(summary(sim))
    }
    console.log(`soak took ${Date.now() - started} ms`)
    expect(sim.outcome).toBe('playing')
    expect(sim.citizens.size).toBeGreaterThan(10)
  }, 300_000)
})
