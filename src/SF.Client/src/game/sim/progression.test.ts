import { describe, expect, it } from 'vitest'
import { energyBlocked } from './energy'
import { eventHandler } from './events'
import { canPlace, footprintSize, placeBuilding } from './placement'
import { addResearchPoints, isUnlocked } from './research'
import { Simulation, SAVE_VERSION, type ColonySnapshot } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

function hq(sim: Simulation): Building {
  return sim.headquarters()!
}

/** Places a finished building with its top-left corner at (x, y), ignoring research. */
function build(sim: Simulation, def: string, x: number, y: number): Building {
  const d = sim.def(def)
  const [w, h] = footprintSize(d, 0)
  const check = canPlace(sim, d, x, y, 0, undefined, undefined, true)
  if (!check.ok) throw new Error(`${def} at ${x},${y}: ${check.reason}`)
  return placeBuilding(sim, d, x, y, 0, w, h, true)
}

/** Lays conduit tiles directly (as if builders had finished them). */
function lay(sim: Simulation, network: string, tiles: number[]): void {
  const n = sim.rules.networks.findIndex((x) => x.id === network)
  for (const t of tiles) sim.world.conduit[t] |= 1 << n
  sim.energy.dirty = true
}

function row(sim: Simulation, x0: number, x1: number, y: number): number[] {
  const out: number[] = []
  for (let x = x0; x <= x1; x++) out.push(sim.world.index(x, y))
  return out
}

describe('the Steamforge', () => {
  it('is the headquarters: placed at founding, stores the supplies and cannot be demolished', () => {
    const sim = newColony()
    const forge = hq(sim)
    expect(forge.def).toBe('steamforge')
    expect(sim.perform({ type: 'demolish', building: forge.id }).ok).toBe(false)
    runSeconds(sim, 2)
    expect(forge.data.lit).toBe(true)
    expect(sim.energy.totals[0].supply).toBeGreaterThan(0)
  })

  it('burns firewood from its own stores, and laborers top it up from other storage', () => {
    const sim = newColony()
    const forge = hq(sim)
    const before = forge.stock.firewood ?? 0
    runMonths(sim, 2)
    expect(sim.stats.consumed.firewood ?? 0).toBeGreaterThan(0)
    expect(forge.stock.firewood ?? 0).toBeLessThan(before + 1)
  })
})

describe('research', () => {
  it('locks advanced buildings, roads and networks until researched', () => {
    const sim = newColony()
    const forge = hq(sim)
    const smelter = canPlace(sim, sim.def('smelter'), forge.x + 8, forge.y, 0)
    expect(smelter).toEqual({ ok: false, reason: 'Requires research: Bloomery Metallurgy.' })
    expect(sim.perform({ type: 'road', road: 'cobble', tiles: [sim.world.index(forge.x + 8, forge.y)] }).ok).toBe(false)
    expect(sim.perform({ type: 'conduit', network: 'steam', tiles: [sim.world.index(forge.x + 8, forge.y)] }).ok).toBe(false)
    expect(isUnlocked(sim, 'building', 'drafting-office')).toBe(true)
    expect(isUnlocked(sim, 'building', 'cottage')).toBe(true)
  })

  it('queues unfinished requirements first and unlocks content on completion', () => {
    const sim = newColony()
    expect(sim.perform({ type: 'research', tech: 'piping' }).ok).toBe(true)
    expect(sim.research.queue).toEqual(['mining', 'metallurgy', 'piping'])
    addResearchPoints(sim, 20)
    expect(sim.research.done).toContain('mining')
    expect(sim.research.queue[0]).toBe('metallurgy')
    expect(isUnlocked(sim, 'building', 'iron-mine')).toBe(true)
    expect(sim.notices.some((n) => n.text.includes('Research complete: Deep Mining'))).toBe(true)
    // Progress is kept when the queue changes.
    addResearchPoints(sim, 10)
    sim.perform({ type: 'research', tech: 'tailoring' })
    sim.perform({ type: 'research', tech: 'metallurgy' })
    expect(sim.research.progress.metallurgy).toBe(10)
  })

  it('engineers at a drafting office earn research points as time passes', () => {
    const sim = newColony()
    const forge = hq(sim)
    build(sim, 'drafting-office', forge.x + 5, forge.y - 6)
    sim.perform({ type: 'research', tech: 'mining' })
    runMonths(sim, 6)
    expect(sim.research.done.includes('mining') || (sim.research.progress.mining ?? 0) > 2).toBe(true)
  })

  it('Tinkerer colonies start with some research done', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    expect(sim.research.done).toEqual(expect.arrayContaining(['masonry', 'tailoring']))
    expect(isUnlocked(sim, 'building', 'rowhouse')).toBe(true)
  })
})

describe('energy networks', () => {
  it('a workshop built against the Steamforge gets steam without pipes', () => {
    const sim = newColony()
    const forge = hq(sim)
    const works = build(sim, 'machine-works', forge.x + forge.w, forge.y)
    runSeconds(sim, 8)
    expect(works.workers.length).toBeGreaterThan(0)
    expect(works.data.power).toBeCloseTo(1, 5)
    expect(energyBlocked(sim, works)).toBe(false)
  })

  it('a distant workshop is idle until a steam pipe connects it', () => {
    const sim = newColony()
    const forge = hq(sim)
    const x = forge.x + forge.w + 4
    const works = build(sim, 'machine-works', x, forge.y)
    runSeconds(sim, 8)
    expect(works.data.power).toBe(0)
    expect(energyBlocked(sim, works)).toBe(true)
    lay(sim, 'steam', row(sim, forge.x + forge.w, x - 1, forge.y))
    runSeconds(sim, 2)
    expect(works.data.power).toBeCloseTo(1, 5)
  })

  it('builders lay ordered pipes once piping is researched, spending iron', () => {
    const sim = newColony()
    sim.research.done.push('mining', 'metallurgy', 'piping')
    const forge = hq(sim)
    const tiles = row(sim, forge.x + forge.w, forge.x + forge.w + 3, forge.y + 1)
    const iron = sim.totals.iron ?? 0
    runSeconds(sim, 1)
    expect(sim.perform({ type: 'conduit', network: 'steam', tiles }).ok).toBe(true)
    expect(sim.conduitJobs.size).toBe(4)
    runMonths(sim, 2)
    for (const t of tiles) expect(sim.world.conduit[t] & 1).toBe(1)
    expect(sim.conduitJobs.size).toBe(0)
    expect(sim.totals.iron ?? 0).toBeLessThanOrEqual(iron - 4 + 1e-6)
  })

  it('demand beyond supply slows every required consumer on the grid', () => {
    const sim = newColony()
    const forge = hq(sim)
    const a = build(sim, 'machine-works', forge.x + forge.w, forge.y)
    const b = build(sim, 'steam-sawmill', forge.x - 3, forge.y)
    runSeconds(sim, 8)
    expect(a.workers.length).toBeGreaterThan(0)
    expect(b.workers.length).toBeGreaterThan(0)
    // 12 psi from the Steamforge against 8 + 8 drawn.
    expect(a.data.power).toBeCloseTo(12 / 16, 5)
    expect(b.data.power).toBeCloseTo(12 / 16, 5)
  })

  it('steam radiators heat a tenement without firewood in winter', () => {
    const sim = newColony()
    const forge = hq(sim)
    const home = build(sim, 'steam-tenement', forge.x - 3, forge.y)
    sim.tick = 10 * sim.tpm
    runSeconds(sim, 6)
    expect(home.residents.length).toBeGreaterThan(0)
    expect(home.data.heat).toBeCloseTo(1, 5)
    expect(home.data.heated).toBe(true)
  })

  it('a burst main is torn out and re-ordered for the builders', () => {
    const sim = newColony()
    const forge = hq(sim)
    const tiles = row(sim, forge.x + forge.w, forge.x + forge.w + 6, forge.y)
    lay(sim, 'steam', tiles)
    runSeconds(sim, 2)
    const def = content.events.get('pipe-burst')!
    expect(eventHandler(def.kind)!.run(sim, def)).toBe(true)
    const broken = tiles.filter((t) => !(sim.world.conduit[t] & 1))
    expect(broken.length).toBe(3)
    expect(sim.conduitJobs.size).toBe(3)
  })
})

describe('story', () => {
  it('sends a dispatch when its research is completed, once', () => {
    const sim = newColony()
    sim.research.done.push('mining', 'metallurgy')
    sim.perform({ type: 'research', tech: 'piping' })
    addResearchPoints(sim, 100)
    const story = sim.notices.filter((n) => n.level === 'story')
    expect(story.map((n) => n.dispatch)).toEqual(['piping'])
    expect(sim.story.sent).toEqual(['piping'])
  })

  it('sends year dispatches at the turn of the year', () => {
    const sim = newColony({ difficulty: 'tinkerer' })
    runMonths(sim, 12)
    expect(sim.story.sent).toContain('first-winter')
  })
})

describe('saves', () => {
  it('a colony with pipes, research and dispatches continues exactly after loading', () => {
    const original = newColony({ seed: 11 })
    const forge = hq(original)
    build(original, 'machine-works', forge.x + forge.w + 3, forge.y)
    lay(original, 'steam', row(original, forge.x + forge.w, forge.x + forge.w + 2, forge.y))
    original.research.done.push('mining', 'metallurgy', 'piping')
    original.perform({ type: 'conduit', network: 'steam', tiles: row(original, forge.x + forge.w, forge.x + forge.w + 2, forge.y + 2) })
    original.perform({ type: 'research', tech: 'copper' })
    runMonths(original, 2)
    const loaded = Simulation.deserialize(content, original.serialize())
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
    runMonths(original, 3)
    runMonths(loaded, 3)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
  })

  it('upgrades version 1 saves: the Guildhall becomes the Steamforge and research counts as done', () => {
    const sim = newColony()
    const s = JSON.parse(JSON.stringify(sim.serialize())) as Record<string, unknown> & ColonySnapshot
    s.v = 1
    for (const b of s.buildings) if (b.def === 'steamforge') b.def = 'guildhall'
    delete (s.world as unknown as Record<string, unknown>).conduit
    delete (s as Record<string, unknown>).conduitJobs
    delete (s as Record<string, unknown>).research
    delete (s as Record<string, unknown>).story
    const loaded = Simulation.deserialize(content, s)
    expect(loaded.headquarters()?.def).toBe('steamforge')
    expect(loaded.research.done.length).toBe(content.bundle.research.length)
    expect(loaded.serialize().v).toBe(SAVE_VERSION)
    runMonths(loaded, 1)
    expect(loaded.outcome).toBe('playing')
  })
})
