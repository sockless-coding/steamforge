import type { Content } from '../../api/content'
import type { ForgeDef, ForgeFateDef, RelicEffect } from '../../api/types'
import { forgeWorksFactors } from './components/forgeworks'
import { energyBlocked, networkIndex } from './energy'
import { ignite } from './events'
import { guildState } from './guilds'
import { addToStorage, takeFromStorage } from './inventory'
import { firstName, surname } from './names'
import { createCitizen, emigrate, killCitizen, placeReturning } from './population'
import { Rng } from './rng'
import type { Simulation } from './simulation'
import { sendDispatch } from './story'
import type { Building, Citizen, Expedition, ForgeState, SagaState } from './types'

// ---------------------------------------------------------------- state

/** A fresh saga: Act I, every forge as the Company last knew it, no expeditions, the core sealed and steady. */
export function foundSaga(content: Content): SagaState {
  const forges: Record<string, ForgeState> = {}
  const relation = content.bundle.forges?.saga.relationStart ?? 50
  for (const f of content.bundle.forges?.forges ?? []) {
    forges[f.id] = f.fate === 'answering' ? { fate: f.fate, visited: false, revealed: true, relation, request: null } : { fate: f.fate, visited: false, revealed: false }
  }
  return { act: 1, relics: [], forges, expeditions: [], nextExpedition: 1, creep: 0, warned: 0, finale: 'none', finaleUntil: 0 }
}

function rules(sim: Simulation) {
  return sim.content.bundle.forges
}

export function fateOf(sim: Simulation, id: string): ForgeFateDef | undefined {
  return rules(sim).fates.find((f) => f.id === id)
}

/** Whether a forge still answers the telegraph. */
export function answering(sim: Simulation, f: ForgeDef): boolean {
  return sim.saga.forges[f.id]?.fate === 'answering'
}

// ---------------------------------------------------------------- the chart

export interface ChartPoint {
  id: string
  leagues: number
  /** Position on the chart, -1..1 with the colony at the centre. */
  x: number
  y: number
}

const chartCache = new WeakMap<Simulation, ChartPoint[]>()

/** Where each forge lies: placed by the colony's seed within its league range, spread around the compass. */
export function chart(sim: Simulation): ChartPoint[] {
  let points = chartCache.get(sim)
  if (points) return points
  const forges = rules(sim).forges
  const rng = new Rng((Math.imul(sim.options.seed ^ 0x2c1b3c6d, 0x297a2d39) + 0x6b43a9b5) >>> 0)
  const max = Math.max(...forges.map((f) => f.leagues[1]), 1)
  const offset = rng.next() * Math.PI * 2
  points = forges.map((f, i) => {
    const leagues = f.leagues[0] + rng.int(f.leagues[1] - f.leagues[0] + 1)
    const angle = offset + (i / forges.length) * Math.PI * 2 + rng.range(-0.22, 0.22)
    const r = 0.18 + 0.78 * (leagues / max)
    return { id: f.id, leagues, x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  })
  chartCache.set(sim, points)
  return points
}

/** Months each way to a forge. */
export function voyageMonths(sim: Simulation, forge: string): number {
  const p = chart(sim).find((c) => c.id === forge)
  return Math.max(1, Math.ceil((p?.leagues ?? 4) / rules(sim).chart.leaguesPerMonth))
}

// ---------------------------------------------------------------- expeditions

export function airshipYard(sim: Simulation): Building | undefined {
  for (const b of sim.buildings.values()) if (!b.site && b.fire === 0 && sim.def(b).components.airshipYard) return b
  return undefined
}

/** Adults who could crew an expedition: people (not automatons), laborers first, then the rest by id. */
function crewCandidates(sim: Simulation): Citizen[] {
  const adult = sim.rules.citizen.adultAge * 12
  const people = [...sim.citizens.values()].filter((c) => !c.automaton && c.age >= adult && c.age < sim.rules.citizen.elderAge * 12 && c.sick === 0)
  return [...people.filter((c) => c.profession === 'laborer'), ...people.filter((c) => c.profession !== 'laborer')]
}

/** Why an expedition cannot leave for a forge with this crew, or null when it can. */
export function launchBlocker(sim: Simulation, forge: string, crew: number): string | null {
  const def = sim.content.forges.get(forge)
  const r = rules(sim).chart
  if (!def) return 'No such forge.'
  const yard = airshipYard(sim)
  if (!yard) return 'Build an Airship Yard first.'
  if (energyBlocked(sim, yard)) return 'The Airship Yard needs steam.'
  if (answering(sim, def)) return `${def.name} still answers: reach it by telegraph.`
  if (sim.saga.expeditions.some((e) => e.forge === forge)) return `An expedition is already bound for ${def.name}.`
  if (sim.saga.expeditions.length >= r.maxExpeditions) return `No more than ${r.maxExpeditions} expeditions can be away at once.`
  if (crew < r.crew[0] || crew > r.crew[1]) return `A crew is ${r.crew[0]} to ${r.crew[1]} strong.`
  if (crewCandidates(sim).length < crew + 2) return 'Not enough fit adults to spare.'
  for (const [res, qty] of Object.entries(r.launchCost)) {
    if ((sim.totals[res] ?? 0) < qty) return `Needs ${qty} ${sim.resource(res)?.name.toLowerCase() ?? res}.`
  }
  return null
}

/** Takes a citizen off the map for a voyage: their job and home are given up; their partner waits for them. */
function sendAway(sim: Simulation, c: Citizen): Citizen {
  emigrate(sim, c, true)
  return c
}

/** Fits out an airship and sends a crew to a forge. */
export function launchExpedition(sim: Simulation, forge: string, crew: number): string | null {
  const blocked = launchBlocker(sim, forge, crew)
  if (blocked) return blocked
  for (const [res, qty] of Object.entries(rules(sim).chart.launchCost)) takeFromStorage(sim, res, qty)
  const chosen = crewCandidates(sim).slice(0, crew).map((c) => sendAway(sim, c))
  const months = voyageMonths(sim, forge)
  const def = sim.content.forges.get(forge)!
  const exp: Expedition = {
    id: sim.saga.nextExpedition++,
    forge,
    crew: chosen,
    departed: sim.monthIndex,
    arrives: sim.monthIndex + months,
    returns: sim.monthIndex + months * 2,
    stage: 'outbound',
    loot: {},
    survivors: 0,
    finds: [],
    lost: false,
  }
  sim.saga.expeditions.push(exp)
  const yard = airshipYard(sim)
  sim.notify('info', `The expedition airship casts off for Forge No. ${def.number}, ${def.name}, with ${crew} aboard. Expected back in ${months * 2} months.`, yard?.door)
  sim.emit({ type: 'expedition', id: exp.id, forge, change: 'departed' })
  return null
}

function roll(sim: Simulation, range: [number, number]): number {
  return range[0] + sim.rng.int(range[1] - range[0] + 1)
}

/** At the forge: the voyage's toll, the salvage, and what the first visitors find. Applied when the ship is home. */
function arrive(sim: Simulation, exp: Expedition): void {
  const def = sim.content.forges.get(exp.forge)!
  const state = sim.saga.forges[exp.forge]
  const fate = fateOf(sim, state.fate)
  const r = rules(sim).chart
  exp.stage = 'returning'
  if (!fate) return
  if (sim.rng.chance(fate.danger * r.shipLossFactor)) {
    exp.lost = true
    return
  }
  exp.crew = exp.crew.filter((c) => {
    if (!sim.rng.chance(fate.danger)) return true
    exp.finds.push(`lost:${c.name}`)
    return false
  })
  const share = state.visited ? r.revisitSalvage : 1
  for (const [res, range] of Object.entries(fate.salvage)) {
    const qty = Math.round(roll(sim, range) * share)
    if (qty > 0) exp.loot[res] = (exp.loot[res] ?? 0) + qty
  }
  if (!state.visited) {
    exp.survivors = roll(sim, fate.survivors)
    if (def.relic) exp.finds.push(`relic:${def.relic}`)
    if (def.blueprint) exp.finds.push(`blueprint:${def.blueprint}`)
    for (const p of def.papers ?? []) exp.finds.push(`papers:${p}`)
  }
}

/** The ship comes home: crew rejoin, salvage goes to storage, survivors settle, finds take effect. */
function homecoming(sim: Simulation, exp: Expedition): void {
  const def = sim.content.forges.get(exp.forge)!
  const state = sim.saga.forges[exp.forge]
  const place = airshipYard(sim) ?? sim.headquarters()
  const door = place?.door ?? 0
  if (exp.lost) {
    for (const c of exp.crew) recordLost(sim, c)
    sim.notify('bad', `The expedition to ${def.name} has not come back. The airship and all ${exp.crew.length} aboard are lost.`)
    return
  }
  state.visited = true
  state.revealed = true
  const lost = exp.finds.filter((f) => f.startsWith('lost:'))
  for (const c of exp.crew) placeReturning(sim, c, door)
  for (const name of lost) {
    sim.stats.deaths++
    sim.stats.deathsBy.expedition = (sim.stats.deathsBy.expedition ?? 0) + 1
    void name
  }
  const got: string[] = []
  for (const [res, qty] of Object.entries(exp.loot)) {
    const left = addToStorage(sim, res, qty, door)
    if (left < qty) got.push(`${Math.round(qty - left)} ${sim.resource(res)?.name.toLowerCase() ?? res}`)
  }
  for (let k = 0; k < exp.survivors; k++) {
    const female = sim.rng.chance(0.5)
    const c = createCitizen(sim, {
      name: `${firstName(sim.rng, female)} ${surname(sim.rng)}`,
      female,
      ageMonths: (18 + sim.rng.int(25)) * 12,
      x: sim.world.xOf(door) + 0.5,
      y: sim.world.yOf(door) + 0.5,
    })
    c.tools = 0
    sim.stats.arrivals++
    sim.emit({ type: 'citizen', id: c.id, change: 'arrived' })
  }
  if (exp.survivors > 0) got.push(`${exp.survivors} survivors`)
  for (const f of exp.finds) {
    const [kind, id] = f.split(':')
    if (kind === 'relic' && !sim.saga.relics.includes(id)) {
      sim.saga.relics.push(id)
      got.push(sim.content.relics.get(id)?.name ?? id)
    } else if (kind === 'blueprint' && !sim.research.done.includes(id)) {
      sim.research.done.push(id)
      sim.research.queue = sim.research.queue.filter((q) => q !== id)
      sim.emit({ type: 'research', tech: id })
      got.push(`the plans for ${sim.content.research.get(id)?.name ?? id}`)
    } else if (kind === 'papers') {
      sendDispatch(sim, id)
    }
  }
  const fate = fateOf(sim, state.fate)
  const toll = lost.length ? ` ${lost.length} did not come back.` : ''
  sim.notify('good', `The expedition is home from ${def.name}${fate ? ` (${fate.name.toLowerCase()})` : ''}.${got.length ? ` It brought ${got.join(', ')}.` : ''}${toll}`, door)
  sim.housingDirty = true
  sim.jobsDirty = true
}

function recordLost(sim: Simulation, _c: Citizen): void {
  sim.stats.deaths++
  sim.stats.deathsBy.expedition = (sim.stats.deathsBy.expedition ?? 0) + 1
}

function updateExpeditions(sim: Simulation): void {
  const month = sim.monthIndex
  for (const exp of [...sim.saga.expeditions]) {
    if (exp.stage === 'outbound' && month >= exp.arrives) arrive(sim, exp)
    if (exp.stage === 'returning' && month >= exp.returns) {
      sim.saga.expeditions = sim.saga.expeditions.filter((e) => e !== exp)
      homecoming(sim, exp)
      if (!exp.lost) sim.emit({ type: 'expedition', id: exp.id, forge: exp.forge, change: 'returned' })
    }
  }
}

// ---------------------------------------------------------------- the telegraph

export function telegraphOnline(sim: Simulation): boolean {
  for (const b of sim.buildings.values()) if (!b.site && b.fire === 0 && sim.def(b).components.telegraph) return true
  return false
}

function scheduleRequest(sim: Simulation, state: ForgeState): void {
  const [lo, hi] = rules(sim).saga.requestEveryMonths
  state.nextRequest = sim.monthIndex + lo + sim.rng.int(hi - lo + 1)
}

function fallSilent(sim: Simulation, def: ForgeDef, why: string): void {
  const state = sim.saga.forges[def.id]
  state.fate = def.failFate ?? 'abandoned'
  state.revealed = false
  state.request = null
  sim.notify('bad', `Forge No. ${def.number}, ${def.name}, has stopped answering the telegraph. ${why}`)
}

function updateTelegraph(sim: Simulation): void {
  const s = rules(sim).saga
  const online = telegraphOnline(sim)
  for (const def of rules(sim).forges) {
    const state = sim.saga.forges[def.id]
    if (!state || state.fate !== 'answering' || !def.requests?.length) continue
    if (!state.greeted) {
      if (!online) continue
      state.greeted = true
      if (def.greeting) sendDispatch(sim, def.greeting)
      scheduleRequest(sim, state)
      continue
    }
    state.relation = (state.relation ?? s.relationStart) - s.relationDecayPerYear / 12
    if (state.request && sim.monthIndex >= state.request.expires) {
      state.relation -= s.relationMissed
      const req = def.requests.find((r) => r.id === state.request!.id)
      sim.notify('warn', `${def.name} received nothing from {colony} in time${req ? ` (${Object.keys(req.wants).join(', ')})` : ''}. Their next telegram is colder.`.replace('{colony}', sim.options.name))
      state.request = null
      scheduleRequest(sim, state)
    }
    if (state.relation <= 0) {
      fallSilent(sim, def, 'Without help from the south, they could not hold on.')
      continue
    }
    if (online && !state.request && sim.monthIndex >= (state.nextRequest ?? 0)) {
      const req = def.requests[(state.cursor ?? 0) % def.requests.length]
      state.cursor = (state.cursor ?? 0) + 1
      state.request = { id: req.id, expires: sim.monthIndex + req.months }
      sim.notify('petition', `Telegram from ${def.name}: ${req.text}`)
    }
  }
}

/** Sends the goods an answering forge asked for; its payment comes back by return airship. */
export function fulfilRequest(sim: Simulation, forge: string): string | null {
  const def = sim.content.forges.get(forge)
  const state = def ? sim.saga.forges[def.id] : undefined
  const req = def && state?.request ? def.requests?.find((r) => r.id === state.request!.id) : undefined
  if (!def || !state || !req) return 'They have asked for nothing.'
  if (!telegraphOnline(sim)) return 'The telegraph office is not working.'
  for (const [res, qty] of Object.entries(req.wants)) {
    if ((sim.totals[res] ?? 0) < qty) return `Not enough ${sim.resource(res)?.name.toLowerCase() ?? res} in storage.`
  }
  for (const [res, qty] of Object.entries(req.wants)) takeFromStorage(sim, res, qty)
  const hq = sim.headquarters()
  for (const [res, qty] of Object.entries(req.gives)) if (hq) addToStorage(sim, res, qty, hq.door)
  state.relation = Math.min(100, (state.relation ?? 50) + rules(sim).saga.relationHelp)
  state.request = null
  scheduleRequest(sim, state)
  const gives = Object.entries(req.gives).map(([r, q]) => `${q} ${sim.resource(r)?.name.toLowerCase() ?? r}`).join(', ')
  sim.notify('good', `The goods are on their way to ${def.name}. They send ${gives} by return airship.`)
  return null
}

// ---------------------------------------------------------------- acts, creep and the finale

function creepPapersFound(sim: Simulation): number {
  return rules(sim).saga.creepPapers.filter((p) => sim.story.sent.includes(p)).length
}

function beginAct(sim: Simulation, act: number): void {
  sim.saga.act = act
  for (const d of sim.content.bundle.story.dispatches) if (d.when.act === act) sendDispatch(sim, d.id)
  if (act === 3) {
    sim.saga.finale = 'pending'
    sim.saga.creep = 0
    sim.saga.warned = 0
    for (const def of rules(sim).forges) {
      if (!def.silencedInAct3 || sim.saga.forges[def.id]?.fate !== 'answering') continue
      sendDispatch(sim, def.silencedInAct3)
      fallSilent(sim, def, 'The last telegram broke off mid-sentence.')
    }
  }
}

/** A safety valve stands on the same steam grid as the Steamforge. */
function valveOnForge(sim: Simulation): boolean {
  const hq = sim.headquarters()
  const n = networkIndex(sim, 'steam')
  const grids = sim.energy.grids[n]
  const grid = hq ? grids?.get(hq.id) : undefined
  if (!grid) return false
  for (const b of sim.buildings.values()) if (!b.site && sim.def(b).components.valve && grids.get(b.id) === grid) return true
  return false
}

/** The core ruptures: everything near the Steamforge burns, those closest die, and it never raises steam again. */
export function rupture(sim: Simulation): void {
  const c = rules(sim).saga.creep
  const hq = sim.headquarters()
  sim.saga.finale = 'ruptured'
  sim.saga.creep = 0
  if (!hq) return
  const cx = hq.x + hq.w / 2
  const cy = hq.y + hq.h / 2
  const fire = sim.content.bundle.events.find((e) => e.kind === 'fire' && !e.params.component)
  for (const b of [...sim.buildings.values()]) {
    if (b === hq || b.site || b.fire > 0 || sim.def(b).components.firefighting) continue
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)
    if (fire && d <= c.ruptureRadius) ignite(sim, b, fire)
  }
  for (const p of [...sim.citizens.values()]) {
    if (Math.hypot(p.x - cx, p.y - cy) <= c.ruptureKillRadius) killCitizen(sim, p, 'rupture')
  }
  sim.soot.add(cx, cy, sim.rules.soot.fullSoot * 6)
  sim.notify('bad', 'The Steamforge has ruptured! A column of scalding steam and iron tore through the town, and No. 9 will never raise steam again.', hq.door)
  sendDispatch(sim, 'epilogue-ruptured')
}

function updateCreep(sim: Simulation): void {
  const saga = sim.saga
  const c = rules(sim).saga.creep
  if (saga.finale === 'pending') {
    saga.creep += c.perMonth * (valveOnForge(sim) ? c.valveFactor : 1)
    const warned = c.warnings.filter((w) => saga.creep >= w).length
    if (warned > saga.warned) {
      saga.warned = warned
      const hq = sim.headquarters()
      sim.notify('bad', `The Steamforge's core gauge reads ${Math.round(saga.creep * 100)}% of bursting. Retrofit it or vent it before it lets itself out.`, hq?.door)
    }
    if (saga.creep >= 1) rupture(sim)
  } else if (saga.finale === 'retrofitting') {
    const g = sim.rules.guilds
    if (guildState(sim, 'brotherhood').standing < g.workToRule && sim.rng.chance(c.retrofitSabotageChance)) {
      sim.notify('bad', 'The Brotherhood walked off the retrofit with the core half open.')
      rupture(sim)
    } else if (sim.monthIndex >= saga.finaleUntil) {
      saga.finale = 'retrofitted'
      saga.creep = 0
      sim.notify('good', 'The retrofit is finished. Steamforge No. 9 is lit again under its new governor, and its gauge holds steady.', sim.headquarters()?.door)
      sendDispatch(sim, 'epilogue-retrofitted')
    }
  }
}

/** Why the player cannot make a finale choice right now, or null. */
export function finaleBlocker(sim: Simulation, choice: 'retrofit' | 'vent'): string | null {
  if (sim.saga.finale !== 'pending') return 'The Steamforge is not creeping.'
  if (choice === 'retrofit') {
    if (!sim.research.done.includes('forge-core-retrofit')) return 'Needs the Forge Core Retrofit plans, found at Forge No. 2.'
    const need = rules(sim).saga.creep.retrofitStanding
    if (guildState(sim, 'institute').standing < need) return `Needs the Engineers' Institute at a standing of ${need} or more.`
  }
  return null
}

export function chooseFinale(sim: Simulation, choice: 'retrofit' | 'vent'): string | null {
  const blocked = finaleBlocker(sim, choice)
  if (blocked) return blocked
  const c = rules(sim).saga.creep
  const hq = sim.headquarters()
  if (choice === 'retrofit') {
    sim.saga.finale = 'retrofitting'
    sim.saga.finaleUntil = sim.monthIndex + c.retrofitMonths
    sim.notify('info', `The engineers open Steamforge No. 9. It will raise no steam for ${c.retrofitMonths} months. Keep the Brotherhood on side: a walk-out with the core open would be the end of it.`, hq?.door)
  } else {
    sim.saga.finale = 'decommissioned'
    sim.saga.creep = 0
    guildState(sim, 'brotherhood').standing = Math.min(100, guildState(sim, 'brotherhood').standing + 20)
    guildState(sim, 'institute').standing = Math.max(0, guildState(sim, 'institute').standing - 20)
    sim.notify('info', 'The valves are opened wide and No. 9 is bled cold and sealed. The Brotherhood cheers; the Institute does not.', hq?.door)
    sendDispatch(sim, 'epilogue-decommissioned')
  }
  return null
}

function updateActs(sim: Simulation): void {
  const s = rules(sim).saga
  if (sim.saga.act < 2 && (telegraphOnline(sim) || sim.year >= s.act2Year)) beginAct(sim, 2)
  if (sim.saga.act === 2 && (creepPapersFound(sim) >= s.papersForAct3 || sim.year >= s.act3Year)) beginAct(sim, 3)
}

/** Monthly: expeditions travel, the telegraph rings, the story moves on, and the core creeps. */
export function updateSaga(sim: Simulation): void {
  if (!sim.content.bundle.forges) return
  updateExpeditions(sim)
  updateTelegraph(sim)
  updateActs(sim)
  updateCreep(sim)
}

// ---------------------------------------------------------------- effects on the colony

/** Product of the colony's relic factors of one kind (1 with none). */
export function relicFactor(sim: Simulation, kind: RelicEffect['kind']): number {
  let f = 1
  for (const id of sim.saga.relics) {
    const relic = sim.content.relics.get(id)
    if (relic?.effect.kind === kind) f *= relic.effect.factor
  }
  return f
}

/** The Steamforge's output multiplier: its forge works, relics, the creep's free steam, and the finale. */
export function hqOutputFactor(sim: Simulation): number {
  const saga = sim.saga
  const c = rules(sim)?.saga.creep
  let f = relicFactor(sim, 'hqOutput') * forgeWorksFactors(sim).output
  if (saga.finale === 'pending' && c) f *= 1 + saga.creep * c.outputBonus
  else if (saga.finale === 'retrofitted' && c) f *= c.retrofitOutput
  else if (saga.finale === 'retrofitting' || saga.finale === 'decommissioned' || saga.finale === 'ruptured') f = 0
  return f
}

