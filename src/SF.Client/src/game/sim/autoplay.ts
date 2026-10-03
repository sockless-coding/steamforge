// Test-only scripted player: a Banished-style opening build order that then adds homes, food and fuel as the colony
// grows. Shared by the soak test and the balance report so both measure the same play.
import { footprintSize, findSpot } from './placement'
import type { Simulation } from './simulation'
import { runMonths } from './testing'

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

/** Keeps wood production lean so food gets the hands, as a player would on the Guild panel. */
function staff(sim: Simulation): void {
  const caps: Record<string, number> = {
    'foragers-hut': 2,
    'foresters-lodge': 1,
    'woodcutters-shed': 1,
    quarry: 2,
    toolworks: 1,
    'hunters-lodge': 2,
    'drafting-office': 1,
  }
  for (const b of sim.buildings.values()) {
    const cap = caps[b.def]
    if (cap !== undefined) sim.perform({ type: 'setWorkers', building: b.id, count: cap })
  }
}

function planYear(sim: Simulation, hall: [number, number]): void {
  const pop = sim.citizens.size
  const houses = count(sim, 'cottage') + count(sim, 'rowhouse')
  const families = Math.ceil(pop / 4)
  for (let i = houses; i < families + 1; i++) place(sim, 'cottage', hall)
  if (count(sim, 'crop-field') < Math.ceil(pop / 10)) place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
  if (count(sim, 'foragers-hut') < Math.ceil(pop / 25)) place(sim, 'foragers-hut', [hall[0] - 14, hall[1]])
  if (count(sim, 'woodcutters-shed') < Math.ceil(pop / 25)) place(sim, 'woodcutters-shed', hall)
  if (count(sim, 'quarry') === 0) place(sim, 'quarry', hall)
  if (count(sim, 'drafting-office') === 0) place(sim, 'drafting-office', hall)
  if (sim.year >= 2 && count(sim, 'warehouse') === 0) place(sim, 'warehouse', hall)
  if (sim.year >= 2 && count(sim, 'well') === 0) place(sim, 'well', hall)
  if (sim.year >= 3 && count(sim, 'toolworks') === 0) place(sim, 'toolworks', hall)
  sim.perform({ type: 'setBuilders', count: Math.max(2, Math.round(pop / 8)) })
  staff(sim)
}

export interface Autoplay {
  /** Plays one year: plans at the start, re-staffs each season and welcomes every group of travellers. */
  playYear(): void
}

/** Clears land around the Steamforge, lays the opening build order and returns a player for the following years. */
export function autoplay(sim: Simulation): Autoplay {
  const hallB = [...sim.buildings.values()].find((b) => sim.def(b).headquarters)!
  const hall: [number, number] = [hallB.x + 2, hallB.y + 2]
  const clear: number[] = []
  const tree = sim.featureCode('tree')
  const rock = sim.featureCode('rock')
  sim.world.forRadius(hall[0], hall[1], 16, (i) => {
    if (sim.world.feature[i] === tree || sim.world.feature[i] === rock) clear.push(i)
  })
  sim.perform({ type: 'markClear', tiles: clear, clear: true })
  for (const def of ['foragers-hut', 'cottage', 'cottage', 'drafting-office', 'foresters-lodge', 'woodcutters-shed', 'hunters-lodge', 'cottage']) {
    place(sim, def, hall)
  }
  place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
  // Toolworks need Bloomery Metallurgy (via Deep Mining).
  sim.perform({ type: 'research', tech: 'metallurgy' })
  return {
    playYear: () => {
      planYear(sim, hall)
      for (let m = 0; m < 12 && sim.outcome === 'playing'; m++) {
        runMonths(sim, 1)
        if (sim.petition) sim.perform({ type: 'answerPetition', accept: true })
        if (m % 3 === 2) staff(sim)
      }
    },
  }
}
