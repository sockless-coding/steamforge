// Test-only scripted player: an opening build order around the Steamforge that then adds homes, food and fuel as
// the colony grows, laying brick steam ducts to its homes and workshops. Shared by the soak test and the balance
// report so both measure the same play.
import { footprintSize, findSpot } from './placement'
import { isResearched } from './research'
import type { Simulation } from './simulation'
import { runMonths } from './testing'
import type { Building } from './types'

/** Builds against the Steamforge's walls where there is room (workshops there share its steam without a duct). */
function besideForge(sim: Simulation, def: string, hall: [number, number]): Building | null {
  const forge = sim.headquarters()!
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const spots: [number, number][] = []
  for (let dx = 1 - w; dx < forge.w; dx++) spots.push([forge.x + dx, forge.y - h], [forge.x + dx, forge.y + forge.h])
  for (let dy = 1 - h; dy < forge.h; dy++) spots.push([forge.x - w, forge.y + dy], [forge.x + forge.w, forge.y + dy])
  for (const [x, y] of spots) {
    const result = sim.perform({ type: 'place', def, x, y, rot: 0 })
    if (result.ok && result.building) return sim.buildings.get(result.building)!
  }
  return place(sim, def, hall)
}

function place(sim: Simulation, def: string, near: [number, number], w?: number, h?: number): Building | null {
  const d = sim.def(def)
  const spot = findSpot(sim, w && h ? { ...d, size: [w, h] } : d, near[0], near[1], 60)
  if (!spot) return null
  const [fw, fh] = footprintSize(d, 0, w, h)
  const result = sim.perform({ type: 'place', def, x: spot.x, y: spot.y, rot: 0, w: fw, h: fh })
  const b = result.ok && result.building ? sim.buildings.get(result.building)! : null
  if (b && sim.def(b).components.consumer) duct(sim, b)
  return b
}

/** Lays a brick steam duct on an L-shaped path from a building to the Steamforge (tiles under buildings are skipped). */
function duct(sim: Simulation, b: Building): void {
  const hq = sim.headquarters()
  if (!hq || !(sim.def(b).components.consumer as { uses?: Record<string, number> } | undefined)?.uses?.steam) return
  // Only buildings close to the Steamforge get a duct; brick ducts cost stone and lose pressure fast.
  const gapX = Math.max(0, hq.x - (b.x + b.w), b.x - (hq.x + hq.w))
  const gapY = Math.max(0, hq.y - (b.y + b.h), b.y - (hq.y + hq.h))
  if (gapX + gapY > 8) return
  const world = sim.world
  const x0 = b.x + (b.w >> 1)
  const y0 = b.y + (b.h >> 1)
  const x1 = hq.x + (hq.w >> 1)
  const y1 = hq.y + (hq.h >> 1)
  const tiles: number[] = []
  for (let x = x0; x !== x1; x += Math.sign(x1 - x0)) tiles.push(world.index(x, y0))
  for (let y = y0; y !== y1; y += Math.sign(y1 - y0)) tiles.push(world.index(x1, y))
  sim.perform({ type: 'conduit', network: 'steam', tiles })
}

function count(sim: Simulation, def: string): number {
  return [...sim.buildings.values()].filter((b) => b.def === def).length
}

/** Keeps wood production lean so food gets the hands, as a player would on the Guild panel. */
function staff(sim: Simulation): void {
  const caps: Record<string, number> = {
    'foresters-lodge': 1,
    'woodcutters-shed': 1,
    quarry: 2,
    'coal-pit': 2,
    toolworks: 1,
    'hunters-lodge': 2,
    'drafting-office': 1,
  }
  for (const b of sim.buildings.values()) {
    const cap = caps[b.def]
    if (cap !== undefined) sim.perform({ type: 'setWorkers', building: b.id, count: cap })
  }
}

/** Bloomery Metallurgy for tools, then Steam Baking. */
function chooseResearch(sim: Simulation): void {
  if (sim.research.queue.length > 0) return
  for (const tech of ['metallurgy', 'baking']) {
    if (!isResearched(sim, tech)) {
      sim.perform({ type: 'research', tech })
      return
    }
  }
}

function planYear(sim: Simulation, hall: [number, number]): void {
  const pop = sim.citizens.size
  const houses = count(sim, 'cottage') + count(sim, 'rowhouse')
  const families = Math.ceil(pop / 4)
  for (let i = houses; i < families + 1; i++) place(sim, 'cottage', hall)
  if (count(sim, 'crop-field') < Math.ceil(pop / 10)) place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
  if (count(sim, 'steam-glasshouse') < Math.ceil(pop / 20)) besideForge(sim, 'steam-glasshouse', hall)
  if (count(sim, 'fishing-dock') === 0) place(sim, 'fishing-dock', hall)
  if (count(sim, 'woodcutters-shed') < Math.ceil(pop / 25)) place(sim, 'woodcutters-shed', hall)
  if (count(sim, 'quarry') === 0) place(sim, 'quarry', hall)
  if (sim.year >= 2 && count(sim, 'coal-pit') === 0) place(sim, 'coal-pit', hall)
  if (count(sim, 'drafting-office') === 0) place(sim, 'drafting-office', hall)
  if (sim.year >= 2 && count(sim, 'warehouse') === 0) place(sim, 'warehouse', hall)
  // A well within reach of every cluster: fire spreads fast through a town packed around the Steamforge.
  if (count(sim, 'well') < Math.ceil(pop / 30)) place(sim, 'well', hall)
  if (sim.year >= 3 && count(sim, 'toolworks') === 0) place(sim, 'toolworks', hall)
  if (sim.unlocked('bakehouse') && count(sim, 'bakehouse') === 0) place(sim, 'bakehouse', hall)
  sim.perform({ type: 'setBuilders', count: Math.max(2, Math.round(pop / 8)) })
  chooseResearch(sim)
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
  besideForge(sim, 'steam-glasshouse', hall)
  for (const def of ['cottage', 'cottage', 'foresters-lodge', 'woodcutters-shed', 'hunters-lodge', 'well', 'cottage', 'quarry', 'drafting-office']) {
    place(sim, def, hall)
  }
  place(sim, 'crop-field', [hall[0] + 14, hall[1] + 6], 8, 8)
  chooseResearch(sim)
  return {
    playYear: () => {
      planYear(sim, hall)
      for (let m = 0; m < 12 && sim.outcome === 'playing'; m++) {
        runMonths(sim, 1)
        if (sim.petition) sim.perform({ type: 'answerPetition', accept: true })
        // Guild petitions: grant the first (conciliatory) choice, as a careful player usually would.
        if (sim.guildPetition) sim.perform({ type: 'answerGuildPetition', choice: 0 })
        if (m % 3 === 2) {
          staff(sim)
          chooseResearch(sim)
        }
      }
    },
  }
}
