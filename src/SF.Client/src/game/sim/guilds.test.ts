import { describe, expect, it } from 'vitest'
import { indexContent } from '../../api/content'
import { guildFactors, guildHall, guildState, guildTarget, guildWorkFactor, onStrike, updateGuilds } from './guilds'
import { canPlace, findSpot, footprintSize, placeBuilding } from './placement'
import { createAutomaton } from './population'
import { Simulation, type ColonySnapshot } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building, Citizen } from './types'

function build(sim: Simulation, def: string): Building {
  const d = sim.def(def)
  const hq = sim.headquarters()!
  const spot = findSpot(sim, d, hq.x + 2, hq.y + 2, 40, true)!
  const [w, h] = footprintSize(d, 0)
  expect(canPlace(sim, d, spot.x, spot.y, 0, undefined, undefined, true).ok).toBe(true)
  return placeBuilding(sim, d, spot.x, spot.y, 0, w, h, true)
}

/** Builds a workplace and fills it with adults (the job assigner hires from the laborers). */
function staffed(sim: Simulation, def: string): Building {
  const b = build(sim, def)
  b.workerTarget = sim.maxWorkers(b)
  runSeconds(sim, 2)
  expect(b.workers.length).toBeGreaterThan(0)
  return b
}

const guild = (id: string) => content.guilds.get(id)!

function members(sim: Simulation, id: string): Citizen[] {
  return [...sim.citizens.values()].filter((c) => !c.automaton && content.guildOf.get(c.profession)?.id === id)
}

describe('guilds', () => {
  it('every trade belongs to one guild, and laborers, builders and children to none', () => {
    expect(content.guildOf.get('miner')?.id).toBe('brotherhood')
    expect(content.guildOf.get('engineer')?.id).toBe('institute')
    expect(content.guildOf.get('farmer')?.id).toBe('union')
    expect(content.guildOf.get('smith')?.id).toBe('artisans')
    for (const p of ['laborer', 'builder', 'child']) expect(content.guildOf.has(p)).toBe(false)
  })

  it('start at the preset temperament, and drift towards what their members live through', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    expect(guildState(sim, 'union').standing).toBe(sim.preset.guildTemperament!.startingStanding)
    staffed(sim, 'hunters-lodge')
    const union = guild('union')
    const comfortable = guildTarget(sim, union).target
    for (const c of members(sim, 'union')) {
      c.hunger = 0
      c.happiness = 0.1
    }
    const hungry = guildTarget(sim, union).target
    expect(hungry).toBeLessThan(comfortable - 10)
    const before = guildState(sim, 'union').standing
    updateGuilds(sim)
    expect(guildState(sim, 'union').standing).toBeLessThan(before)
  })

  it('a proud guild works faster, one working to rule slower', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    staffed(sim, 'hunters-lodge')
    const hunter = members(sim, 'union')[0]
    const g = sim.rules.guilds
    guildState(sim, 'union').standing = 90
    expect(guildWorkFactor(sim, hunter)).toBeCloseTo(1 + g.highWorkBonus, 5)
    guildState(sim, 'union').standing = g.workToRule - 1
    expect(guildWorkFactor(sim, hunter)).toBeCloseTo(g.workToRuleFactor, 5)
  })

  it('strike when standing collapses: members leave their posts until it recovers', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    const lodge = staffed(sim, 'hunters-lodge')
    const hall = build(sim, 'guild-hall')
    sim.perform({ type: 'setOption', building: hall.id, key: 'guild', value: 'union' })
    expect(guildHall(sim, 'union')).toBe(hall)
    const s = guildState(sim, 'union')
    s.standing = 2
    s.effects.push({ kind: 'mood', value: -100, until: sim.monthIndex + 3 })
    updateGuilds(sim)
    expect(s.striking).toBe(true)
    const hunter = sim.citizens.get(lodge.workers[0])!
    expect(onStrike(sim, hunter)).toBe(true)
    sim.interrupt(hunter)
    runSeconds(sim, 3)
    expect(sim.isNight).toBe(false)
    expect(hunter.task?.label).toBe('On strike')
    expect(hunter.task?.about).toBe(hall.id)
    s.effects = []
    s.standing = sim.rules.guilds.strike + 10
    updateGuilds(sim)
    expect(s.striking).toBe(false)
  })

  it('automatons in a trade anger its guild and please the Institute; a policy keeps them out', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    staffed(sim, 'woodcutters-shed')
    const quarry = build(sim, 'quarry')
    quarry.workerTarget = 0
    const hq = sim.headquarters()!
    for (let k = 0; k < 3; k++) createAutomaton(sim, sim.world.xOf(hq.door) + 0.5, sim.world.yOf(hq.door) + 0.5)
    // Only automatons are free to hire: every person is a builder.
    sim.builderTarget = 500
    for (const c of sim.citizens.values()) if (!c.automaton && c.profession === 'laborer') c.profession = 'builder'
    const brotherhood = guild('brotherhood')
    const institute = guild('institute')
    const before = guildTarget(sim, brotherhood).target
    const instituteBefore = guildTarget(sim, institute).target
    quarry.workerTarget = 2
    runSeconds(sim, 2)
    expect(quarry.workers.map((id) => sim.citizens.get(id)!.automaton)).toEqual([true, true])
    expect(guildFactors(sim, brotherhood).automatonsInTrade).toBe(2)
    expect(guildTarget(sim, brotherhood).target).toBeLessThan(before)
    expect(guildTarget(sim, institute).target).toBeGreaterThanOrEqual(instituteBefore)
    expect(sim.perform({ type: 'setGuildPolicy', guild: 'brotherhood', mechanise: false }).ok).toBe(true)
    expect(quarry.workers.length).toBe(0)
    runSeconds(sim, 3)
    expect(quarry.workers.some((id) => sim.citizens.get(id)!.automaton)).toBe(false)
  })

  it('a guild hall raises its guild’s standing target', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    staffed(sim, 'hunters-lodge')
    const union = guild('union')
    const without = guildTarget(sim, union).target
    const hall = build(sim, 'guild-hall')
    sim.perform({ type: 'setOption', building: hall.id, key: 'guild', value: 'union' })
    expect(guildTarget(sim, union).target).toBeCloseTo(Math.min(100, without + sim.rules.guilds.weights.hall), 5)
  })
})

describe('guild petitions', () => {
  it('answering applies the chosen effects', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    sim.guildPetition = { id: 'no-new-automata', arrived: sim.tick, expires: sim.tick + sim.tpm }
    const brotherhood = guildState(sim, 'brotherhood').standing
    const institute = guildState(sim, 'institute').standing
    expect(sim.perform({ type: 'answerGuildPetition', choice: 0 }).ok).toBe(true)
    expect(sim.guildPetition).toBeNull()
    expect(guildState(sim, 'brotherhood').standing).toBeCloseTo(Math.min(100, brotherhood + 15), 5)
    expect(guildState(sim, 'institute').standing).toBeCloseTo(Math.max(0, institute - 12), 5)
    expect(sim.noAutomatonsUntil).toBe(sim.monthIndex + 6)
    expect(sim.perform({ type: 'answerGuildPetition', choice: 0 }).ok).toBe(false)
  })

  it('an unanswered petition counts as its last choice', () => {
    const sim = newColony({ seed: 3, difficulty: 'tinkerer' })
    sim.guildPetition = { id: 'winter-rest', arrived: sim.tick, expires: sim.tick + 20 }
    const before = guildState(sim, 'brotherhood').standing
    runSeconds(sim, 3)
    expect(sim.guildPetition).toBeNull()
    expect(guildState(sim, 'brotherhood').standing).toBeLessThan(before)
  })

  it('guilds raise petitions after the grace year, at the preset rate', () => {
    const rules = content.bundle.rules
    const always = { id: 'always', guild: 'union', title: 'Always', text: 'Test petition.', weight: 1, when: {}, choices: [{ label: 'Yes', effects: [] }, { label: 'No', effects: [] }] }
    const eager = indexContent({
      ...content.bundle,
      petitions: [always],
      difficulty: {
        ...content.bundle.difficulty,
        presets: content.bundle.difficulty.presets.map((p) => ({ ...p, guildTemperament: { ...p.guildTemperament!, petitionsPerYear: 12 } })),
      },
      rules,
    })
    const sim = Simulation.create(eager, { seed: 8, name: 'Petitionville', difficulty: 'tinkerer', mapSize: 'small', terrain: 'valley' })
    runMonths(sim, 11)
    expect(sim.notices.some((n) => n.level === 'petition' && n.text.includes('petitions'))).toBe(false)
    let seen = 0
    for (let m = 0; m < 12; m++) {
      runMonths(sim, 1)
      if (sim.guildPetition) {
        seen++
        sim.perform({ type: 'answerGuildPetition', choice: 0 })
      }
    }
    expect(seen).toBeGreaterThan(2)
  })
})

describe('unrest', () => {
  it('a guild at the end of its tether sabotages and emigrates', () => {
    const rules = content.bundle.rules
    const angry = indexContent({ ...content.bundle, rules: { ...rules, guilds: { ...rules.guilds, sabotageChance: 1, emigrationChance: 1 } } })
    const sim = Simulation.create(angry, { seed: 4, name: 'Grimsby', difficulty: 'tinkerer', mapSize: 'small', terrain: 'valley' })
    staffed(sim, 'hunters-lodge')
    const people = sim.population().total
    const s = guildState(sim, 'union')
    s.standing = 0
    s.effects.push({ kind: 'mood', value: -100, until: sim.monthIndex + 3 })
    const notices = sim.notices.length
    updateGuilds(sim)
    expect(sim.stats.departures ?? 0).toBeGreaterThan(0)
    expect(sim.population().total).toBeLessThan(people)
    expect(sim.notices.slice(notices).some((n) => /[Ss]abot/.test(n.text))).toBe(true)
  })
})

describe('guilds and saves', () => {
  it('standings, policies and a waiting petition survive a save exactly', () => {
    const original = newColony({ seed: 5, difficulty: 'tinkerer' })
    guildState(original, 'brotherhood').mechanise = false
    guildState(original, 'union').effects.push({ kind: 'work', value: 0.8, until: original.monthIndex + 2 })
    original.guildPetition = { id: 'apprentices', arrived: original.tick, expires: original.tick + original.tpm }
    runMonths(original, 1)
    const loaded = Simulation.deserialize(content, original.serialize())
    runMonths(original, 2)
    runMonths(loaded, 2)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(original.serialize()))
  })

  it('version 6 saves gain guilds at the preset standing', () => {
    const sim = newColony({ seed: 5, difficulty: 'ironclad' })
    const s = JSON.parse(JSON.stringify(sim.serialize())) as Partial<ColonySnapshot> & ColonySnapshot
    s.v = 6
    delete (s as Partial<ColonySnapshot>).guilds
    delete (s as Partial<ColonySnapshot>).guildPetition
    delete (s as Partial<ColonySnapshot>).noAutomatonsUntil
    const loaded = Simulation.deserialize(content, s)
    expect(Object.keys(loaded.guilds).sort()).toEqual(content.bundle.guilds.map((g) => g.id).sort())
    expect(loaded.guilds.brotherhood.standing).toBe(content.presets.get('ironclad')!.guildTemperament!.startingStanding)
    expect(loaded.guildPetition).toBeNull()
    runSeconds(loaded, 10)
  })
})
