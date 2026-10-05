import { automatonsAllowed } from './guilds'
import { familyName, firstName, surname } from './names'
import type { Simulation } from './simulation'
import { foodIds } from './inventory'
import { abortTask } from './tasks'
import type { Building, Citizen } from './types'
import { outputsOf } from './work'

export interface NewCitizen {
  name: string
  female: boolean
  ageMonths: number
  x: number
  y: number
  mother?: number
  father?: number
  home?: number
  /** A clockwork automaton: never counted as a person. */
  automaton?: boolean
}

export function createCitizen(sim: Simulation, n: NewCitizen): Citizen {
  const r = sim.rules.citizen
  const adult = n.ageMonths >= r.adultAge * 12
  const c: Citizen = {
    id: sim.nextId++,
    name: n.name,
    female: n.female,
    age: n.ageMonths,
    partner: 0,
    mother: n.mother ?? 0,
    father: n.father ?? 0,
    home: 0,
    workplace: 0,
    profession: adult ? 'laborer' : 'child',
    x: n.x,
    y: n.y,
    px: n.x,
    py: n.y,
    path: null,
    pathI: 0,
    inside: 0,
    task: null,
    carry: null,
    hunger: 0.8 + sim.rng.next() * 0.2,
    warmth: 1,
    health: 1,
    happiness: 0.7,
    tools: 0,
    coat: 0,
    sick: 0,
    sickRate: 0,
    diet: [],
    wait: sim.rng.int(20),
  }
  if (n.automaton) c.automaton = true
  sim.citizens.set(c.id, c)
  if (n.home) moveInto(sim, c, n.home)
  sim.jobsDirty = true
  sim.housingDirty = true
  sim.stats.peakPopulation = Math.max(sim.stats.peakPopulation, sim.population().total)
  return c
}

const AUTOMATON_NAMES = ['Jack', 'Tock', 'Gideon', 'Barnaby', 'Septimus', 'Ada', 'Percival', 'Millicent', 'Ignatius', 'Hester']

/**
 * A clockwork automaton: an adult laborer that never eats, freezes, marries or ages, but must be wound with coal
 * every few months and eventually seizes up.
 */
export function createAutomaton(sim: Simulation, x: number, y: number): Citizen {
  const r = sim.rules.automaton
  const serial = Math.round(sim.stats.produced.automaton ?? 0) + 1
  const c = createCitizen(sim, {
    name: `Clockwork ${sim.rng.pick(AUTOMATON_NAMES)} No. ${serial}`,
    female: false,
    ageMonths: sim.rules.citizen.adultAge * 12,
    x,
    y,
    automaton: true,
  })
  c.wind = r.windMonths
  c.hunger = 1
  c.happiness = 0.6
  return c
}

const causeText: Record<string, string> = {
  starvation: 'starved to death',
  cold: 'froze to death',
  age: 'died of old age',
  sickness: 'succumbed to fever',
  soot: 'died of black lung',
  fire: 'perished in a fire',
  wear: 'seized up for good',
  sabotage: 'was smashed by saboteurs',
  rupture: 'was killed when the Steamforge ruptured',
}

export function killCitizen(sim: Simulation, c: Citizen, cause: string): void {
  abortTask(sim, c)
  if (c.workplace) fireWorker(sim, c.id)
  leaveHome(sim, c)
  const partner = sim.citizens.get(c.partner)
  if (partner) partner.partner = 0
  sim.citizens.delete(c.id)
  if (!c.automaton) sim.stats.deaths++
  sim.stats.deathsBy[cause] = (sim.stats.deathsBy[cause] ?? 0) + 1
  sim.jobsDirty = true
  sim.housingDirty = true
  sim.emit({ type: 'citizen', id: c.id, change: 'died', cause })
  sim.notify(cause === 'age' || cause === 'wear' ? 'info' : 'bad', `${c.name} ${causeText[cause] ?? 'died'}.`, sim.world.index(Math.floor(c.x), Math.floor(c.y)))
}

/**
 * A citizen leaves the map: their job and home are given up and their partner is freed. For good (emigration, a
 * departure) or, with `voyage`, for an expedition: they keep their own partner link so the couple can be reunited.
 */
export function emigrate(sim: Simulation, c: Citizen, voyage = false): void {
  abortTask(sim, c)
  if (c.workplace) fireWorker(sim, c.id)
  leaveHome(sim, c)
  const partner = sim.citizens.get(c.partner)
  if (partner) partner.partner = 0
  if (!voyage) c.partner = 0
  sim.citizens.delete(c.id)
  if (!voyage) sim.stats.departures = (sim.stats.departures ?? 0) + 1
  sim.jobsDirty = true
  sim.housingDirty = true
  sim.emit({ type: 'citizen', id: c.id, change: 'left' })
}

/** A returning crew member steps off the airship at a tile, homeless and jobless, and is reunited with their partner if still free. */
export function placeReturning(sim: Simulation, c: Citizen, tile: number): void {
  c.x = c.px = sim.world.xOf(tile) + 0.5
  c.y = c.py = sim.world.yOf(tile) + 0.5
  c.task = null
  c.path = null
  c.carry = null
  c.inside = 0
  c.home = 0
  c.workplace = 0
  if (c.profession !== 'child') c.profession = 'laborer'
  const partner = sim.citizens.get(c.partner)
  if (partner && partner.partner === 0) partner.partner = c.id
  else c.partner = 0
  sim.citizens.set(c.id, c)
  sim.emit({ type: 'citizen', id: c.id, change: 'arrived' })
}

function leaveHome(sim: Simulation, c: Citizen): void {
  const home = sim.buildings.get(c.home)
  if (home) home.residents = home.residents.filter((id) => id !== c.id)
  c.home = 0
}

function moveInto(sim: Simulation, c: Citizen, houseId: number): void {
  if (c.home === houseId) return
  leaveHome(sim, c)
  const house = sim.buildings.get(houseId)
  if (!house) return
  house.residents.push(c.id)
  c.home = houseId
}

export function fireWorker(sim: Simulation, id: number): void {
  const c = sim.citizens.get(id)
  if (!c) return
  const b = sim.buildings.get(c.workplace)
  if (b) b.workers = b.workers.filter((w) => w !== id)
  c.workplace = 0
  delete c.pinned
  if (c.profession !== 'child') c.profession = 'laborer'
  if (c.task?.kind === 'work') abortTask(sim, c)
  sim.jobsDirty = true
}

function hire(sim: Simulation, c: Citizen, b: Building): void {
  const workplace = sim.component<{ profession: string }>(b, 'workplace')!
  c.workplace = b.id
  c.profession = workplace.profession
  b.workers.push(c.id)
  if (c.task && (c.task.kind === 'labor' || c.task.kind === 'idle' || c.task.kind === 'build')) abortTask(sim, c)
}

/** The worker a workplace lets go first when it has too many: the last the overseer placed, else the last of all. */
export function workerToLetGo(sim: Simulation, b: Building): number {
  for (let i = b.workers.length - 1; i >= 0; i--) if (!sim.citizens.get(b.workers[i])?.pinned) return b.workers[i]
  return b.workers[b.workers.length - 1]
}

/**
 * Moves a worker to another workplace of the same trade, keeping any task under way (the caller hands them their
 * next one). Used when their own workplace has nothing for them to do.
 */
export function transferWorker(sim: Simulation, c: Citizen, to: Building): void {
  const from = sim.buildings.get(c.workplace)
  if (from) from.workers = from.workers.filter((w) => w !== c.id)
  c.workplace = to.id
  to.workers.push(c.id)
  sim.jobsDirty = true
}

/** Whether a citizen could take a place at a workplace (ignoring how many already work there). */
export function canWorkAt(sim: Simulation, c: Citizen, b: Building): boolean {
  if (b.site || b.fire > 0 || !sim.def(b).components.workplace || sim.maxWorkers(b) === 0) return false
  return !c.automaton || automatonsAllowed(sim, b)
}

/** Builders on the payroll. */
function builderCount(sim: Simulation): number {
  let n = 0
  for (const c of sim.citizens.values()) if (c.profession === 'builder') n++
  return n
}

/**
 * The player's direct order: puts a citizen to a workplace (raising its worker target if need be), to building or
 * to labour, and pins them there; or with 'auto' hands them back to the overseer in their current job.
 */
export function assignCitizen(sim: Simulation, c: Citizen, job: number | 'laborer' | 'builder' | 'auto'): string | null {
  if (!isAdult(sim, c)) return 'Children cannot work.'
  if (job === 'auto') {
    delete c.pinned
    sim.jobsDirty = true
    return null
  }
  if (typeof job === 'number') {
    const b = sim.buildings.get(job)
    if (!b || !canWorkAt(sim, c, b)) return c.automaton && b && !automatonsAllowed(sim, b) ? 'The guild will not have automatons in this trade.' : 'Nobody can work there.'
    if (c.workplace !== b.id) {
      const max = sim.maxWorkers(b)
      if (b.workers.length >= max && b.workers.every((id) => sim.citizens.get(id)?.pinned)) return 'Every place there is taken.'
      if (c.workplace) fireWorker(sim, c.id)
      else if (c.profession === 'builder') c.profession = 'laborer'
      if (b.workers.length >= max) fireWorker(sim, workerToLetGo(sim, b))
      if (c.task?.kind === 'work') abortTask(sim, c)
      hire(sim, c, b)
      b.workerTarget = Math.max(b.workerTarget, b.workers.length)
    }
  } else {
    if (c.workplace) fireWorker(sim, c.id)
    if (job === 'builder') {
      if (c.profession !== 'builder') {
        c.profession = 'builder'
        if (c.task?.kind === 'labor' || c.task?.kind === 'idle') abortTask(sim, c)
      }
      sim.builderTarget = Math.max(sim.builderTarget, builderCount(sim))
    } else if (c.profession === 'builder') {
      c.profession = 'laborer'
      if (c.task?.kind === 'build') abortTask(sim, c)
    }
  }
  c.pinned = true
  sim.jobsDirty = true
  return null
}

function isAdult(sim: Simulation, c: Citizen): boolean {
  return c.age >= sim.rules.citizen.adultAge * 12
}

/** Whether a workplace feeds the colony: it produces a food (fields, hunters, fishers, glasshouses, bakeries). */
function feedsColony(sim: Simulation, b: Building): boolean {
  return outputsOf(sim, b).some((res) => sim.resource(res)?.category === 'food')
}

/** Months of meals the stores hold for the current population. */
export function monthsOfFood(sim: Simulation): number {
  const r = sim.rules.citizen
  const pop = sim.population().total
  if (pop === 0) return Infinity
  let food = 0
  for (const f of foodIds(sim)) food += sim.totals[f] ?? 0
  return food / (pop * r.mealSize * r.hungerPerMonth * sim.mods.hungerRate)
}

/** The free worker nearest a workplace's door who may work there, or -1. */
function nearestFor(sim: Simulation, pool: Citizen[], b: Building): number {
  const bots = automatonsAllowed(sim, b)
  const x = sim.world.xOf(b.door) + 0.5
  const y = sim.world.yOf(b.door) + 0.5
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < pool.length; i++) {
    if (!bots && pool[i].automaton) continue
    const d = Math.abs(pool[i].x - x) + Math.abs(pool[i].y - y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Hires from the pool into the short-handed workplace with the fewest workers (earlier in `workplaces` on a tie), so
 * every trade gets a hand before any gets a second and a workplace finished late is not left empty.
 */
function fill(sim: Simulation, workplaces: Building[], pool: Citizen[]): void {
  const open = workplaces.filter((b) => b.workers.length < b.workerTarget)
  while (pool.length > 0 && open.length > 0) {
    let k = 0
    for (let j = 1; j < open.length; j++) if (open[j].workers.length < open[k].workers.length) k = j
    const b = open[k]
    const i = nearestFor(sim, pool, b)
    if (i >= 0) hire(sim, pool.splice(i, 1)[0], b)
    if (i < 0 || b.workers.length >= b.workerTarget) open.splice(k, 1)
  }
}

/**
 * Fills workplaces up to their targets and keeps the builder count at the player's setting. Every workplace gets a
 * hand before any gets a second, food workplaces first on a tie; while the stores run short of food, food
 * workplaces still short-handed take hands from other trades: one at a time from the trade with the most workers,
 * never its last. Citizens the player placed themselves are never moved, and are let go last when a target falls.
 */
export function assignJobs(sim: Simulation): void {
  sim.jobsDirty = false
  for (const b of sim.buildings.values()) {
    while (b.workers.length > b.workerTarget) fireWorker(sim, workerToLetGo(sim, b))
  }
  const builders: Citizen[] = []
  for (const c of sim.citizens.values()) if (c.profession === 'builder') builders.push(c)
  // Builders the player chose go last.
  builders.sort((a, z) => Number(!!a.pinned) - Number(!!z.pinned))
  while (builders.length > sim.builderTarget) {
    const c = builders.pop()!
    c.profession = 'laborer'
    delete c.pinned
    if (c.task?.kind === 'build') abortTask(sim, c)
  }

  const pool: Citizen[] = []
  for (const c of sim.citizens.values()) {
    if (isAdult(sim, c) && c.profession === 'laborer' && !c.workplace && !c.pinned) pool.push(c)
  }
  const food: Building[] = []
  const other: Building[] = []
  for (const b of sim.buildings.values()) {
    if (b.site || b.fire > 0 || !sim.def(b).components.workplace) continue
    ;(feedsColony(sim, b) ? food : other).push(b)
  }
  fill(sim, [...food, ...other], pool)
  if (pool.length === 0 && monthsOfFood(sim) < sim.rules.workplace.foodFirstMonths) {
    const movable = (o: Building) => o.workers.map((id) => sim.citizens.get(id)!).filter((c) => c && !c.pinned)
    for (const b of food) {
      while (b.workers.length < b.workerTarget) {
        let donor: Building | null = null
        for (const o of other) {
          if (o.workers.length > 1 && (!donor || o.workers.length > donor.workers.length) && movable(o).length > 0) donor = o
        }
        if (!donor) break
        const hands = movable(donor)
        const i = nearestFor(sim, hands, b)
        if (i < 0) break
        fireWorker(sim, hands[i].id)
        hire(sim, hands[i], b)
      }
    }
  }
  while (builders.length < sim.builderTarget && pool.length > 0) {
    const c = pool.shift()!
    c.profession = 'builder'
    if (c.task?.kind === 'labor' || c.task?.kind === 'idle') abortTask(sim, c)
    builders.push(c)
  }
}

function housingCapacity(sim: Simulation, b: Building): number {
  return sim.component<{ capacity: number }>(b, 'housing')?.capacity ?? 0
}

function related(a: Citizen, b: Citizen): boolean {
  return (
    (a.mother !== 0 && a.mother === b.mother) ||
    (a.father !== 0 && a.father === b.father) ||
    a.mother === b.id ||
    a.father === b.id ||
    b.mother === a.id ||
    b.father === a.id
  )
}

function childrenOf(sim: Simulation, parents: Citizen[]): Citizen[] {
  const ids = new Set(parents.map((p) => p.id))
  const out: Citizen[] = []
  for (const c of sim.citizens.values()) {
    if (!isAdult(sim, c) && (ids.has(c.mother) || ids.has(c.father))) out.push(c)
  }
  return out
}

/**
 * Banished-style households: an empty house is claimed by a homeless family, then a homeless adult, then a couple
 * still living with their parents, and finally two single adults who marry and move in together. Anyone left
 * homeless squeezes into a house with room.
 */
export function assignHousing(sim: Simulation): void {
  sim.housingDirty = false
  const r = sim.rules.citizen
  const houses: Building[] = []
  for (const b of sim.buildings.values()) if (!b.site && b.fire === 0 && housingCapacity(sim, b) > 0) houses.push(b)
  const adults = () => [...sim.citizens.values()].filter((c) => isAdult(sim, c) && !c.automaton)

  for (const house of houses) {
    if (house.residents.length > 0) continue
    const people = adults()
    let movers: Citizen[] | null = null

    const homelessCouple = people.find((c) => !c.home && c.partner && !sim.citizens.get(c.partner)?.home)
    if (homelessCouple) movers = [homelessCouple, sim.citizens.get(homelessCouple.partner)!]
    if (!movers) {
      const single = people.find((c) => !c.home)
      if (single) movers = [single]
    }
    if (!movers) {
      // A couple sharing a home with other adults (usually the parents) moves out.
      const crowded = people.find((c) => {
        const p = sim.citizens.get(c.partner)
        const home = sim.buildings.get(c.home)
        return p && p.home === c.home && home && home.residents.filter((id) => isAdult(sim, sim.citizens.get(id)!)).length > 2
      })
      if (crowded) movers = [crowded, sim.citizens.get(crowded.partner)!]
    }
    if (!movers) {
      const marriageable = people.filter((c) => !c.partner && c.age >= r.partnerAge * 12)
      let man: Citizen | undefined
      let woman: Citizen | undefined
      for (const m of marriageable) {
        if (m.female) continue
        woman = marriageable.find((w) => w.female && !related(m, w))
        if (woman) {
          man = m
          break
        }
      }
      if (man && woman) {
        man.partner = woman.id
        woman.partner = man.id
        woman.name = `${woman.name.split(' ')[0]} ${familyName(man.name)}`
        movers = [man, woman]
        sim.notify('good', `${man.name.split(' ')[0]} and ${woman.name} have married and moved into a new home.`, house.door)
      }
    }
    if (!movers) break
    const family = [...movers, ...childrenOf(sim, movers).filter((k) => !k.home || k.home === movers![0].home || k.home === movers![1]?.home)]
    for (const c of family.slice(0, housingCapacity(sim, house))) moveInto(sim, c, house.id)
  }

  // One household per house: homeless adults wait for a vacant home (sheltering at the Guildhall), but children
  // always go home to their parents.
  for (const c of sim.citizens.values()) {
    if (c.home || isAdult(sim, c)) continue
    const parentHome = sim.citizens.get(c.mother)?.home || sim.citizens.get(c.father)?.home
    if (parentHome) moveInto(sim, c, parentHome)
  }
}

/** Monthly births: a couple at home with room may have a child. */
export function births(sim: Simulation): void {
  const r = sim.rules.citizen
  for (const house of [...sim.buildings.values()]) {
    if (house.site || house.residents.length >= housingCapacity(sim, house)) continue
    for (const id of house.residents) {
      const mother = sim.citizens.get(id)
      if (!mother?.female || !mother.partner) continue
      const father = sim.citizens.get(mother.partner)
      if (!father || father.home !== house.id) continue
      if (mother.age < r.partnerAge * 12 || mother.age > r.fertileAgeMax * 12) continue
      const happiness = 0.5 + (mother.happiness + father.happiness) / 2
      const crowding = 1 - house.residents.length / (housingCapacity(sim, house) + 1)
      if (!sim.rng.chance(r.birthChancePerMonth * sim.mods.birthRate * happiness * (0.5 + crowding))) continue
      const female = sim.rng.chance(0.5)
      const child = createCitizen(sim, {
        name: `${firstName(sim.rng, female)} ${familyName(father.name)}`,
        female,
        ageMonths: 0,
        x: sim.world.xOf(house.door) + 0.5,
        y: sim.world.yOf(house.door) + 0.5,
        mother: mother.id,
        father: father.id,
        home: house.id,
      })
      child.inside = house.id
      sim.stats.births++
      sim.emit({ type: 'citizen', id: child.id, change: 'born' })
      sim.notify('good', `${child.name} was born.`, house.door)
      break
    }
  }
}

function spawnTile(sim: Simulation, center: number, radius: number): { x: number; y: number } {
  const world = sim.world
  const cx = world.xOf(center)
  const cy = world.yOf(center)
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = cx + sim.rng.int(radius * 2 + 1) - radius
    const y = cy + sim.rng.int(radius * 2 + 1) - radius
    if (world.inBounds(x, y) && world.walkable(world.index(x, y))) return { x: x + 0.5, y: y + 0.5 }
  }
  return { x: cx + 0.5, y: cy + 0.5 }
}

function equipFounder(sim: Simulation, c: Citizen): void {
  const r = sim.rules.citizen
  if (c.profession === 'child') return
  c.tools = Math.round(r.toolLifeMonths * (0.4 + sim.rng.next() * 0.6))
  if ((sim.preset.startingResources.coats ?? 0) > 0) c.coat = Math.round(r.coatLifeMonths * (0.4 + sim.rng.next() * 0.6))
}

/** A household arriving together: two adults and up to `kids` children. */
export function spawnFamily(sim: Simulation, near: number, kids: number, minAge = 18): Citizen[] {
  const family = surname(sim.rng)
  const pos = () => spawnTile(sim, near, 4)
  const father = createCitizen(sim, { name: `${firstName(sim.rng, false)} ${family}`, female: false, ageMonths: (minAge + 2 + sim.rng.int(18)) * 12 + sim.rng.int(12), ...pos() })
  const mother = createCitizen(sim, { name: `${firstName(sim.rng, true)} ${family}`, female: true, ageMonths: (minAge + sim.rng.int(16)) * 12 + sim.rng.int(12), ...pos() })
  father.partner = mother.id
  mother.partner = father.id
  const members = [father, mother]
  for (let k = 0; k < kids; k++) {
    const female = sim.rng.chance(0.5)
    members.push(createCitizen(sim, {
      name: `${firstName(sim.rng, female)} ${family}`,
      female,
      ageMonths: (1 + sim.rng.int(10)) * 12 + sim.rng.int(12),
      mother: mother.id,
      father: father.id,
      ...pos(),
    }))
  }
  for (const m of members) equipFounder(sim, m)
  return members
}

export function createFounders(sim: Simulation, sx: number, sy: number): void {
  const door = sim.world.index(sx, sy + 2)
  for (let f = 0; f < sim.preset.startingFamilies; f++) spawnFamily(sim, door, sim.rng.int(3))
  assignHousing(sim)
  assignJobs(sim)
}
