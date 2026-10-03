import type { GuildDef, GuildTemperament, PetitionDef, PetitionEffect } from '../../api/types'
import { isLit } from './components/lighting'
import { eventHandler, ignite } from './events'
import { addToStorage, foodIds, takeFromStorage } from './inventory'
import { emigrate, killCitizen } from './population'
import type { Simulation } from './simulation'
import { sootExposure } from './soot'
import type { Building, Citizen, GuildState } from './types'

const DEFAULT_TEMPERAMENT: GuildTemperament = { startingStanding: 55, standingDrift: 1, petitionsPerYear: 2 }

export function temperament(sim: Simulation): GuildTemperament {
  return sim.preset.guildTemperament ?? DEFAULT_TEMPERAMENT
}

/** Fresh guild states for a new colony (or a save from before the guilds). */
export function foundGuilds(sim: Pick<Simulation, 'content'>, standing: number): Record<string, GuildState> {
  const out: Record<string, GuildState> = {}
  for (const g of sim.content.bundle.guilds ?? []) out[g.id] = { standing, striking: false, mechanise: true, effects: [] }
  return out
}

/** The guild a citizen's trade belongs to (automatons belong to none). */
export function guildOfCitizen(sim: Simulation, c: Citizen): GuildDef | undefined {
  return c.automaton ? undefined : sim.content.guildOf.get(c.profession)
}

/** The guild a workplace's trade belongs to. */
export function guildOfBuilding(sim: Simulation, b: Building): GuildDef | undefined {
  const wp = sim.component<{ profession: string }>(b, 'workplace')
  return wp ? sim.content.guildOf.get(wp.profession) : undefined
}

export function guildState(sim: Simulation, id: string): GuildState {
  let s = sim.guilds[id]
  if (!s) s = sim.guilds[id] = { standing: temperament(sim).startingStanding, striking: false, mechanise: true, effects: [] }
  return s
}

/** The finished, unburnt guild hall serving a guild, if any. */
export function guildHall(sim: Simulation, id: string): Building | undefined {
  for (const b of sim.buildings.values()) {
    if (!b.site && b.fire === 0 && sim.def(b).components.guildHall && b.data.guild === id) return b
  }
  return undefined
}

export interface GuildFactors {
  members: number
  /** Automatons working the guild's trades. */
  automatonsInTrade: number
  fed: number
  warm: number
  health: number
  happiness: number
  soot: number
  nightShift: number
  hall: number
  /** Mechanisation share for the guild's automaton scope (0-1). */
  automatons: number
}

/** Conditions of a guild's members, each a share or a mean from 0 to 1. */
export function guildFactors(sim: Simulation, guild: GuildDef): GuildFactors {
  const r = sim.rules.citizen
  let members = 0
  let fed = 0
  let warm = 0
  let health = 0
  let happiness = 0
  let soot = 0
  let night = 0
  let botsInTrade = 0
  let bots = 0
  let adults = 0
  for (const c of sim.citizens.values()) {
    if (c.automaton) {
      bots++
      if (c.workplace) {
        const b = sim.buildings.get(c.workplace)
        if (b && guildOfBuilding(sim, b)?.id === guild.id) botsInTrade++
      }
      continue
    }
    if (c.age >= r.adultAge * 12) adults++
    if (guildOfCitizen(sim, c)?.id !== guild.id) continue
    members++
    if (c.hunger > r.hungerThreshold) fed++
    if (c.warmth > r.warmthThreshold || sim.coldness <= 0) warm++
    health += c.health
    happiness += c.happiness
    const work = c.workplace ? sim.buildings.get(c.workplace) : undefined
    soot += work ? sootExposure(sim, work.x + work.w / 2, work.y + work.h / 2) : sootExposure(sim, c.x, c.y)
    if (work && isLit(sim, work)) night++
  }
  const share = (n: number) => (members > 0 ? n / members : 0)
  const automatons = guild.automatons.scope === 'trade' ? (members + botsInTrade > 0 ? botsInTrade / (members + botsInTrade) : 0) : adults + bots > 0 ? bots / (adults + bots) : 0
  return {
    members,
    automatonsInTrade: botsInTrade,
    fed: share(fed),
    warm: share(warm),
    health: share(health),
    happiness: share(happiness),
    soot: share(soot),
    nightShift: share(night),
    hall: guildHall(sim, guild.id) ? 1 : 0,
    automatons,
  }
}

/** Where a guild's standing is heading, and the contributions that make it up (for the Guild panel). */
export function guildTarget(sim: Simulation, guild: GuildDef, f = guildFactors(sim, guild)): { target: number; parts: [string, number][] } {
  const g = sim.rules.guilds
  const w = g.weights
  const state = guildState(sim, guild.id)
  const mood = state.effects.filter((e) => e.kind === 'mood').reduce((s, e) => s + e.value, 0)
  const parts: [string, number][] = [
    ['Fed', w.fed * f.fed],
    ['Warm', w.warm * f.warm],
    ['Healthy', w.health * f.health],
    ['Content', w.happiness * f.happiness],
    ['Coal smoke', w.soot * f.soot],
    ['Night shifts', w.nightShift * f.nightShift],
    ['Guild hall', w.hall * f.hall],
    ['Automatons', guild.automatons.weight * f.automatons],
    ['Petitions', mood],
  ]
  const target = f.members === 0 ? 50 + mood : g.base + parts.reduce((s, [, v]) => s + v, 0)
  return { target: Math.max(0, Math.min(100, target)), parts }
}

export type GuildMood = 'proud' | 'content' | 'grumbling' | 'workToRule' | 'striking'

export function guildMood(sim: Simulation, id: string): GuildMood {
  const g = sim.rules.guilds
  const s = guildState(sim, id)
  if (s.striking) return 'striking'
  if (s.standing < g.workToRule) return 'workToRule'
  if (s.standing >= g.high) return 'proud'
  if (s.standing < 45) return 'grumbling'
  return 'content'
}

/** Work-speed factor from a citizen's guild: pride, working to rule and petition effects. */
export function guildWorkFactor(sim: Simulation, c: Citizen): number {
  const guild = guildOfCitizen(sim, c)
  if (!guild) return 1
  const g = sim.rules.guilds
  const s = sim.guilds[guild.id]
  if (!s) return 1
  let f = 1
  if (s.standing >= g.high) f *= 1 + g.highWorkBonus
  else if (s.standing < g.workToRule) f *= g.workToRuleFactor
  for (const e of s.effects) if (e.kind === 'work') f *= e.value
  return f
}

/** Whether a citizen's guild is out on strike (members leave their workplaces). */
export function onStrike(sim: Simulation, c: Citizen): boolean {
  const guild = guildOfCitizen(sim, c)
  return !!guild && !!c.workplace && sim.guilds[guild.id]?.striking === true
}

/** Whether automatons may take a place at this workplace. */
export function automatonsAllowed(sim: Simulation, b: Building): boolean {
  const guild = guildOfBuilding(sim, b)
  return !guild || sim.guilds[guild.id]?.mechanise !== false
}

// ---------------------------------------------------------------- monthly update

function notifyGuild(sim: Simulation, level: 'good' | 'warn' | 'bad', text: string, at?: number): void {
  sim.notify(level, text, at)
}

/** Lets go every automaton working a guild's trades (after the guild's policy forbids them). */
export function releaseAutomatons(sim: Simulation, guild: string): void {
  for (const c of sim.citizens.values()) {
    if (!c.automaton || !c.workplace) continue
    const b = sim.buildings.get(c.workplace)
    if (!b || guildOfBuilding(sim, b)?.id !== guild) continue
    b.workers = b.workers.filter((w) => w !== c.id)
    c.workplace = 0
    c.profession = 'laborer'
    if (c.task?.kind === 'work') {
      c.task = null
      c.path = null
    }
  }
  sim.jobsDirty = true
}

function sabotage(sim: Simulation, guild: GuildDef): void {
  const options: (() => boolean)[] = []
  const bots = [...sim.citizens.values()].filter((c) => {
    const b = c.automaton && c.workplace ? sim.buildings.get(c.workplace) : undefined
    return b && guildOfBuilding(sim, b)?.id === guild.id
  })
  if (bots.length) {
    options.push(() => {
      const bot = sim.rng.pick(bots)!
      notifyGuild(sim, 'bad', `Saboteurs from the ${guild.short} have smashed ${bot.name} with hammers.`, sim.world.index(Math.floor(bot.x), Math.floor(bot.y)))
      killCitizen(sim, bot, 'sabotage')
      return true
    })
  }
  const burst = sim.content.bundle.events.find((e) => e.kind === 'pipeBurst')
  if (burst) {
    options.push(() => {
      const ok = eventHandler('pipeBurst')!.run(sim, { ...burst, name: `Sabotage by the ${guild.short}` })
      return ok
    })
  }
  const fire = sim.content.bundle.events.find((e) => e.kind === 'fire' && !e.params.component)
  const workplaces = [...sim.buildings.values()].filter((b) => !b.site && b.fire === 0 && guildOfBuilding(sim, b)?.id === guild.id && !sim.def(b).headquarters)
  if (fire && workplaces.length) {
    options.push(() => {
      const target = sim.rng.pick(workplaces)!
      ignite(sim, target, fire)
      notifyGuild(sim, 'bad', `Sabotage! Someone from the ${guild.short} has set the ${sim.def(target).name} alight.`, target.door)
      return true
    })
  }
  while (options.length) {
    const i = sim.rng.int(options.length)
    if (options[i]()) return
    options.splice(i, 1)
  }
}

function emigration(sim: Simulation, guild: GuildDef): void {
  const members = [...sim.citizens.values()].filter((c) => guildOfCitizen(sim, c)?.id === guild.id)
  const leaver = sim.rng.pick(members)
  if (!leaver) return
  const household = leaver.home ? [...sim.citizens.values()].filter((c) => !c.automaton && c.home === leaver.home) : [leaver]
  notifyGuild(sim, 'bad', `Fed up with the colony, ${leaver.name} of the ${guild.short} has left for the south${household.length > 1 ? `, taking ${household.length - 1} of the household` : ''}.`)
  for (const c of household) emigrate(sim, c)
}

/** Monthly: effects expire, standing drifts towards its target, strikes start and end, unrest boils over. */
export function updateGuilds(sim: Simulation): void {
  const g = sim.rules.guilds
  const month = sim.monthIndex
  const t = temperament(sim)
  for (const guild of sim.content.bundle.guilds ?? []) {
    const s = guildState(sim, guild.id)
    s.effects = s.effects.filter((e) => e.until > month)
    const f = guildFactors(sim, guild)
    const { target } = guildTarget(sim, guild, f)
    const rate = g.drift * (target < s.standing ? t.standingDrift : 1)
    s.standing = Math.max(0, Math.min(100, s.standing + (target - s.standing) * Math.min(1, rate)))
    if (f.members === 0) {
      s.striking = false
      continue
    }
    if (!s.striking && s.standing < g.strike) {
      s.striking = true
      const hall = guildHall(sim, guild.id)
      notifyGuild(sim, 'bad', `The ${guild.name} has walked out! Its members will not work until conditions improve.`, hall?.door)
    } else if (s.striking && s.standing >= g.strike + 5) {
      s.striking = false
      notifyGuild(sim, 'good', `The ${guild.short} is back at work.`)
    } else if (!s.striking && s.standing < g.workToRule && sim.season.months[0] === sim.month) {
      notifyGuild(sim, 'warn', `The ${guild.short} is working to rule. Its standing is ${Math.round(s.standing)}: see the Guild panel.`)
    }
    if (s.standing <= g.unrest) {
      if (sim.rng.chance(g.sabotageChance)) sabotage(sim, guild)
      if (sim.rng.chance(g.emigrationChance)) emigration(sim, guild)
    }
  }
  rollGuildPetition(sim)
}

// ---------------------------------------------------------------- petitions

function eligible(sim: Simulation, p: PetitionDef): boolean {
  const guild = sim.content.guilds.get(p.guild)
  if (!guild) return false
  const w = p.when
  const s = guildState(sim, guild.id)
  if (w.season && sim.season.id !== w.season) return false
  if (w.minStanding !== undefined && s.standing < w.minStanding) return false
  if (w.maxStanding !== undefined && s.standing > w.maxStanding) return false
  if (w.credit !== undefined && sim.credit < w.credit) return false
  if (w.resource && (sim.totals[w.resource.id] ?? 0) < w.resource.min) return false
  if (w.food !== undefined && foodIds(sim).reduce((n, f) => n + (sim.totals[f] ?? 0), 0) < w.food) return false
  if (w.building && ![...sim.buildings.values()].some((b) => b.def === w.building && !b.site)) return false
  if (w.minMembers !== undefined || w.automatonsInTrade !== undefined || w.sootAbove !== undefined) {
    const f = guildFactors(sim, guild)
    if (f.members < (w.minMembers ?? 1)) return false
    if (w.automatonsInTrade !== undefined && f.automatonsInTrade < w.automatonsInTrade) return false
    if (w.sootAbove !== undefined && f.soot < w.sootAbove) return false
  }
  if (p.choices.some((c) => c.effects.some((e) => e.kind === 'mechanise')) && !s.mechanise) return false
  return true
}

/** Monthly: a guild may raise a petition (preset petitionsPerYear), never in the grace years or while one waits. */
export function rollGuildPetition(sim: Simulation): void {
  if (sim.guildPetition) return
  if (sim.monthIndex < sim.rules.events.graceYears * sim.rules.months.length) return
  if (!sim.rng.chance(temperament(sim).petitionsPerYear / 12)) return
  const list = (sim.content.bundle.petitions ?? []).filter((p) => eligible(sim, p))
  const i = sim.rng.weighted(list.map((p) => p.weight))
  if (i < 0) return
  const p = list[i]
  sim.guildPetition = { id: p.id, arrived: sim.tick, expires: sim.tick + Math.round(sim.rules.guilds.petitionWaitMonths * sim.tpm) }
  const guild = sim.content.guilds.get(p.guild)!
  const hall = guildHall(sim, guild.id)
  sim.notify('petition', `The ${guild.short} petitions: ${p.title}.`, hall?.door)
}

function applyEffect(sim: Simulation, p: PetitionDef, e: PetitionEffect): void {
  const month = sim.monthIndex
  switch (e.kind) {
    case 'standing': {
      const s = guildState(sim, e.guild ?? p.guild)
      s.standing = Math.max(0, Math.min(100, s.standing + e.amount))
      break
    }
    case 'mood':
      guildState(sim, e.guild ?? p.guild).effects.push({ kind: 'mood', value: e.amount, until: month + e.months })
      break
    case 'workFactor':
      guildState(sim, e.guild ?? p.guild).effects.push({ kind: 'work', value: e.factor, until: month + e.months })
      break
    case 'mechanise': {
      const id = e.guild ?? p.guild
      guildState(sim, id).mechanise = e.value
      if (!e.value) releaseAutomatons(sim, id)
      break
    }
    case 'noAutomatons':
      sim.noAutomatonsUntil = Math.max(sim.noAutomatonsUntil, month + e.months)
      break
    case 'resource': {
      const hq = sim.headquarters()
      if (e.amount >= 0) {
        if (hq) addToStorage(sim, e.resource, e.amount, hq.door)
      } else if (e.resource === 'food') {
        let want = -e.amount
        for (const f of foodIds(sim)) if (want > 0) want -= takeFromStorage(sim, f, want)
      } else {
        takeFromStorage(sim, e.resource, -e.amount)
      }
      break
    }
    case 'credit':
      sim.credit = Math.max(0, sim.credit + e.amount)
      break
    case 'happiness':
      for (const c of sim.citizens.values()) if (!c.automaton) c.happiness = Math.min(1, c.happiness + e.amount)
      break
  }
}

/** Answers the waiting guild petition with one of its choices. */
export function answerGuildPetition(sim: Simulation, choice: number): boolean {
  const waiting = sim.guildPetition
  const p = waiting ? sim.content.petitions.get(waiting.id) : undefined
  if (!p || choice < 0 || choice >= p.choices.length) return false
  sim.guildPetition = null
  for (const e of p.choices[choice].effects) applyEffect(sim, p, e)
  const guild = sim.content.guilds.get(p.guild)!
  sim.notify('info', `${guild.short}, ${p.title}: ${p.choices[choice].label}.`)
  return true
}

/** Each second: a petition left unanswered too long counts as its last choice (usually a refusal). */
export function updateGuildPetition(sim: Simulation): void {
  const waiting = sim.guildPetition
  if (!waiting || sim.tick < waiting.expires) return
  const p = sim.content.petitions.get(waiting.id)
  if (!p) {
    sim.guildPetition = null
    return
  }
  const guild = sim.content.guilds.get(p.guild)!
  sim.notify('warn', `Nobody answered the ${guild.short}'s petition, ${p.title}. They take it as a refusal.`)
  answerGuildPetition(sim, p.choices.length - 1)
}
