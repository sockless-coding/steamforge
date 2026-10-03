import type { EventDef } from '../../api/types'
import type { FieldPhase } from './components/field'
import type { FirefightingConfig } from './components/basic'
import { energyBlocked, networkIndex } from './energy'
import { addToStorage } from './inventory'
import { assignHousing, createCitizen, spawnFamily } from './population'
import { firstName, surname } from './names'
import { removeBuilding } from './placement'
import type { Simulation } from './simulation'
import { sootExposure } from './soot'
import type { Building, Citizen, Petition } from './types'

/** Handler for one event kind (events.json `kind`). Returns false when it could not fire (no valid target). */
export interface EventHandler {
  readonly kind: string
  run(sim: Simulation, def: EventDef): boolean
}

const handlers = new Map<string, EventHandler>()

export function registerEvent(handler: EventHandler): void {
  handlers.set(handler.kind, handler)
}

export function eventHandler(kind: string): EventHandler | undefined {
  return handlers.get(kind)
}

const num = (def: EventDef, key: string, fallback: number) => (typeof def.params[key] === 'number' ? (def.params[key] as number) : fallback)

// ---------------------------------------------------------------- fire

/** The headquarters (a riveted iron engine) never catches fire: losing it would end the colony outright. */
export function burnable(sim: Simulation, b: Building): boolean {
  const def = sim.def(b)
  return !def.walkable && !def.headquarters && !def.components.firefighting && b.fire === 0
}

/**
 * The quickest firefighting cover for a building, as seconds until its fire is out, or null when no well or
 * working fire station reaches it. Fire stations that need steam only help while they have it.
 */
export function fireCover(sim: Simulation, b: Building, wellSeconds: number): number | null {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  let best: number | null = null
  for (const w of sim.buildings.values()) {
    const cfg = sim.component<FirefightingConfig>(w, 'firefighting')
    if (!cfg || w.site || energyBlocked(sim, w)) continue
    const dx = w.x + w.w / 2 - cx
    const dy = w.y + w.h / 2 - cy
    if (dx * dx + dy * dy > cfg.radius * cfg.radius) continue
    const seconds = Math.min(wellSeconds, cfg.burnSeconds ?? wellSeconds)
    best = best === null ? seconds : Math.min(best, seconds)
  }
  return best
}

export function ignite(sim: Simulation, b: Building, def: EventDef): void {
  const cover = fireCover(sim, b, num(def, 'wellBurnSeconds', 10))
  const covered = cover !== null
  b.fire = cover ?? num(def, 'burnSeconds', 45)
  b.data.fireCovered = covered
  b.data.fireSpread = num(def, 'spreadChance', 0.04)
  b.data.fireRadius = num(def, 'spreadRadius', 3)
  b.data.fireEvent = def.id
  for (const c of sim.citizens.values()) if (c.inside === b.id) c.inside = 0
  sim.emit({ type: 'fire', building: b.id, active: true })
}

/** Per-second fire progress: spreading to neighbours, then either put out (near a well) or burnt down. */
export function updateFires(sim: Simulation): void {
  const burning = [...sim.buildings.values()].filter((b) => b.fire > 0)
  for (const b of burning) {
    if (!sim.buildings.has(b.id)) continue
    b.fire--
    const covered = b.data.fireCovered === true
    const spread = ((b.data.fireSpread as number) ?? 0.04) * (covered ? 0.25 : 1)
    const radius = (b.data.fireRadius as number) ?? 3
    const def = sim.content.events.get(b.data.fireEvent as string)
    if (def) {
      for (const other of sim.buildings.values()) {
        if (other === b || !burnable(sim, other)) continue
        const gapX = Math.max(0, Math.max(other.x - (b.x + b.w), b.x - (other.x + other.w)))
        const gapY = Math.max(0, Math.max(other.y - (b.y + b.h), b.y - (other.y + other.h)))
        if (gapX <= radius && gapY <= radius && sim.rng.chance(spread)) {
          ignite(sim, other, def)
          sim.notify('bad', `The fire has spread to the ${sim.def(other).name}!`, other.door)
        }
      }
    }
    if (b.fire > 0) continue
    sim.emit({ type: 'fire', building: b.id, active: false })
    if (covered) {
      for (const res in b.stock) b.stock[res] = Math.floor(b.stock[res] / 2)
      sim.notify('info', `Townsfolk with buckets saved the ${sim.def(b).name}.`, b.door)
    } else {
      sim.notify('bad', `The ${sim.def(b).name} burned to the ground.`, b.door)
      removeBuilding(sim, b)
    }
  }
}

registerEvent({
  kind: 'fire',
  run: (sim, def) => {
    const component = def.params.component as string | undefined
    // A boiler burst needs a lit firebox.
    const candidates = [...sim.buildings.values()].filter(
      (b) =>
        !b.site &&
        burnable(sim, b) &&
        !sim.def(b).headquarters &&
        (!component || (sim.def(b).components[component] && (component !== 'generator' || b.data.lit === true))),
    )
    const target = sim.rng.pick(candidates)
    if (!target) return false
    ignite(sim, target, def)
    sim.notify('bad', `${def.name}! The ${sim.def(target).name} is ablaze.`, target.door)
    return true
  },
})

// ---------------------------------------------------------------- others

/** Children and elders take fever harder: enough to kill them if they were already weak. */
function infect(sim: Simulation, c: Citizen, months: number, healthPerMonth: number, vulnerableFactor: number): void {
  const r = sim.rules.citizen
  const vulnerable = c.age < r.adultAge * 12 || c.age >= r.elderAge * 12
  c.sick = months
  c.sickRate = healthPerMonth * (vulnerable ? vulnerableFactor : 1)
}

registerEvent({
  kind: 'blight',
  run: (sim, def) => {
    const fields = [...sim.buildings.values()].filter((b) => {
      const phase = b.data.phase as FieldPhase | undefined
      return phase === 'grow' || phase === 'harvest' || phase === 'plant'
    })
    if (fields.length === 0) return false
    for (let n = 0; n < num(def, 'fields', 1) && fields.length; n++) {
      const field = fields.splice(sim.rng.int(fields.length), 1)[0]
      field.data.plots = (field.data.plots as number[]).map(() => 0)
      field.data.growth = 0
      field.data.phase = 'fallow'
      sim.emit({ type: 'building', id: field.id, change: 'changed' })
      sim.notify('bad', `${def.name} has wiped out a field of crops.`, field.door)
    }
    return true
  },
})

registerEvent({
  kind: 'sickness',
  run: (sim, def) => {
    const people = [...sim.citizens.values()].filter((c) => c.sick === 0 && !c.automaton)
    const count = Math.max(1, Math.round(people.length * num(def, 'fraction', 0.1)))
    if (people.length === 0) return false
    for (let n = 0; n < count && people.length; n++) {
      infect(sim, people.splice(sim.rng.int(people.length), 1)[0], num(def, 'months', 3), num(def, 'healthPerMonth', 0.12), num(def, 'vulnerableFactor', 1))
    }
    sim.notify('bad', `${def.name} is spreading: ${count} citizens have fallen ill.`)
    return true
  },
})

/** Black lung: a cough that settles on those who breathe the worst of the smoke. Needs sooty air to strike. */
registerEvent({
  kind: 'blackLung',
  run: (sim, def) => {
    const threshold = num(def, 'minExposure', 0.3)
    const exposed = [...sim.citizens.values()].filter((c) => c.sick === 0 && !c.automaton && sootExposure(sim, c.x, c.y) >= threshold)
    if (exposed.length === 0) return false
    const count = Math.max(1, Math.round(exposed.length * num(def, 'fraction', 0.3)))
    for (let n = 0; n < count && exposed.length; n++) {
      infect(sim, exposed.splice(sim.rng.int(exposed.length), 1)[0], num(def, 'months', 3), num(def, 'healthPerMonth', 0.12), num(def, 'vulnerableFactor', 1))
    }
    sim.notify('bad', `${def.name}: ${count} citizens in the smokiest streets have taken to coughing. Apothecaries and cleaner air would help.`)
    return true
  },
})

/** A rain squall scrubs the air and washes grime off the streets. Only worth announcing when there is soot to wash. */
registerEvent({
  kind: 'rain',
  run: (sim, def) => {
    const f = sim.soot
    let grime = 0
    for (let i = 0; i < f.grime.length; i++) grime = Math.max(grime, f.grime[i])
    if (grime < sim.rules.soot.fullGrime * 0.1 && f.total() < sim.rules.soot.fullSoot) return false
    const air = 1 - num(def, 'washSoot', 0.8)
    const ground = 1 - num(def, 'washGrime', 0.4)
    for (let i = 0; i < f.soot.length; i++) {
      f.soot[i] *= air
      f.grime[i] *= ground
    }
    sim.notify('good', `${def.name}: a downpour has washed the soot from the air and the grime from the streets.`)
    return true
  },
})

registerEvent({
  kind: 'coldSnap',
  run: (sim, def) => {
    sim.weather.snapDegrees = num(def, 'degrees', -8)
    sim.weather.snapMonths = num(def, 'months', 2)
    sim.notify('warn', `${def.name}: bitter cold is sweeping in. Make sure every home has firewood.`)
    return true
  },
})

/**
 * Travellers ask to join rather than simply arriving: they wait at the headquarters until the player welcomes or
 * turns them away (answerPetition), and move on if nobody answers.
 */
registerEvent({
  kind: 'nomads',
  run: (sim, def) => {
    const hq = sim.headquarters()
    if (sim.petition || !hq) return false
    const min = num(def, 'min', 3)
    const total = min + sim.rng.int(Math.max(1, num(def, 'max', 7) - min + 1))
    const households: number[] = []
    let people = 0
    while (people + 2 <= total) {
      const kids = Math.min(total - people - 2, sim.rng.int(3))
      households.push(kids)
      people += 2 + kids
    }
    if (people < total) households.push(-1)
    const adults = households.reduce((n, h) => n + (h < 0 ? 1 : 2), 0)
    const petition: Petition = {
      households,
      adults,
      children: total - adults,
      feverish: sim.rng.chance(num(def, 'feverChance', 0)),
      event: def.id,
      arrived: sim.tick,
      expires: sim.tick + Math.round(num(def, 'waitMonths', 1) * sim.tpm),
    }
    sim.petition = petition
    const fever = petition.feverish ? ' Some of them are coughing.' : ''
    sim.notify('petition', `${def.name}: ${total} travellers ask to join the colony.${fever}`, hq.door)
    return true
  },
})

/** Welcomes the waiting travellers (they settle in, bringing fever if they carry it) or sends them on their way. */
export function answerPetition(sim: Simulation, accept: boolean): void {
  const p = sim.petition
  if (!p) return
  sim.petition = null
  const hq = sim.headquarters()
  if (!accept || !hq) {
    sim.notify('info', 'The travellers shoulder their packs and move on.')
    return
  }
  const arrivals: Citizen[] = []
  for (const kids of p.households) {
    if (kids >= 0) {
      arrivals.push(...spawnFamily(sim, hq.door, kids, 16))
      continue
    }
    const female = sim.rng.chance(0.5)
    arrivals.push(
      createCitizen(sim, {
        name: `${firstName(sim.rng, female)} ${surname(sim.rng)}`,
        female,
        ageMonths: (17 + sim.rng.int(15)) * 12,
        x: sim.world.xOf(hq.door) + 0.5,
        y: sim.world.yOf(hq.door) + 0.5,
      }),
    )
  }
  // Travellers own the clothes on their backs but no tools.
  for (const c of arrivals) {
    c.tools = 0
    sim.emit({ type: 'citizen', id: c.id, change: 'arrived' })
  }
  const def = sim.content.events.get(p.event)
  if (p.feverish && def) {
    const months = num(def, 'feverMonths', 2)
    const fever = sim.content.bundle.events.find((e) => e.kind === 'sickness')
    const rate = fever ? num(fever, 'healthPerMonth', 0.12) : 0.12
    const factor = fever ? num(fever, 'vulnerableFactor', 1) : 1
    for (const c of arrivals) if (sim.rng.chance(0.5)) infect(sim, c, months, rate, factor)
    // ...and they pass it on to a few colonists.
    const locals = [...sim.citizens.values()].filter((c) => c.sick === 0 && !c.automaton)
    for (let n = 1 + sim.rng.int(3); n > 0 && locals.length > 0; n--) {
      infect(sim, locals.splice(sim.rng.int(locals.length), 1)[0], months, rate, factor)
    }
  }
  sim.stats.arrivals += arrivals.length
  assignHousing(sim)
  sim.notify('good', `${arrivals.length} travellers have joined the colony${p.feverish ? ', and brought fever with them' : ''}.`, hq.door)
}

/** Travellers who wait too long give up. */
export function updatePetition(sim: Simulation): void {
  if (sim.petition && sim.tick >= sim.petition.expires) {
    sim.petition = null
    sim.notify('info', 'Nobody answered the travellers at the gate, so they moved on.')
  }
}

registerEvent({
  kind: 'bounty',
  run: (sim, def) => {
    const fields = [...sim.buildings.values()].filter((b) => b.data.phase === 'grow')
    if (fields.length === 0) return false
    for (const f of fields) f.data.growth = Math.min(0.99, (f.data.growth as number) + num(def, 'growth', 0.25))
    sim.notify('good', `${def.name}: warm rain has the crops racing ahead.`)
    return true
  },
})

registerEvent({
  kind: 'pipeBurst',
  run: (sim, def) => {
    const network = (def.params.network as string | undefined) ?? sim.rules.networks[0].id
    const n = networkIndex(sim, network)
    if (n < 0) return false
    const world = sim.world
    const bit = 1 << n
    // Only conduits carrying energy can burst.
    const pipes: number[] = []
    for (let i = 0; i < world.size; i++) if (world.conduit[i] & bit) pipes.push(i)
    if (pipes.length < 4 || (sim.energy.totals[n]?.supply ?? 0) <= 0) return false
    const start = sim.rng.pick(pipes)!
    // The burst tears out a short run of connected pipe; builders re-lay it.
    const burst: number[] = [start]
    for (let k = 0; k < burst.length && burst.length < num(def, 'tiles', 3); k++) {
      const x = world.xOf(burst[k])
      const y = world.yOf(burst[k])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = world.index(x + dx, y + dy)
        if (world.inBounds(x + dx, y + dy) && world.conduit[j] & bit && !burst.includes(j) && burst.length < num(def, 'tiles', 3)) burst.push(j)
      }
    }
    for (const tile of burst) {
      world.conduit[tile] &= ~bit
      sim.conduitJobs.set(tile * 8 + n, { tile, network })
      sim.emit({ type: 'conduit', tile })
    }
    sim.energy.dirty = true
    const conduit = sim.rules.networks[n].conduit.name.toLowerCase()
    sim.notify('bad', `${def.name}! A ${conduit} has ruptured. Builders will re-lay ${burst.length} sections.`, start)
    return true
  },
})

registerEvent({
  kind: 'supplies',
  run: (sim, def) => {
    const hq = sim.headquarters()
    if (!hq) return false
    const delivered: string[] = []
    for (const [res, qty] of Object.entries(def.params)) {
      if (typeof qty !== 'number' || !sim.resource(res)) continue
      const left = addToStorage(sim, res, qty, hq.door)
      if (left < qty) delivered.push(`${Math.round(qty - left)} ${sim.resource(res)!.name.toLowerCase()}`)
    }
    if (delivered.length === 0) return false
    sim.notify('good', `${def.name}: crates dropped by the Company airship hold ${delivered.join(', ')}.`, hq.door)
    return true
  },
})

/**
 * Monthly roll for disasters and blessings, weighted by events.json and scaled by difficulty. An event that cannot
 * happen right now (no lit boiler, no fields) is set aside and another is drawn, so the configured rates hold.
 * Disasters keep a minimum spacing so misfortune does not strike in back-to-back streaks.
 */
export function rollEvents(sim: Simulation): void {
  const e = sim.rules.events
  const pick = (disaster: boolean): boolean => {
    const eligible = sim.content.bundle.events.filter(
      (d) => d.disaster === disaster && sim.year >= d.minYear && (!d.seasons || d.seasons.includes(sim.season.id)) && handlers.has(d.kind),
    )
    while (eligible.length > 0) {
      const index = sim.rng.weighted(eligible.map((d) => d.weight))
      if (index < 0) return false
      if (handlers.get(eligible[index].kind)!.run(sim, eligible[index])) return true
      eligible.splice(index, 1)
    }
    return false
  }
  const month = sim.monthIndex
  const graceOver = month >= e.graceYears * sim.rules.months.length
  const spaced = month - sim.lastDisaster >= e.minMonthsBetweenDisasters
  if (graceOver && spaced && sim.rng.chance((e.disastersPerYear / 12) * sim.mods.disasterRate) && pick(true)) sim.lastDisaster = month
  if (sim.rng.chance(e.blessingsPerYear / 12)) pick(false)
}
