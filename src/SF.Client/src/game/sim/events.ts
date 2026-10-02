import type { EventDef } from '../../api/types'
import type { FieldPhase } from './components/field'
import type { FirefightingConfig } from './components/basic'
import { assignHousing, createCitizen, spawnFamily } from './population'
import { firstName, surname } from './names'
import { removeBuilding } from './placement'
import type { Simulation } from './simulation'
import type { Building } from './types'

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

export function burnable(sim: Simulation, b: Building): boolean {
  const def = sim.def(b)
  return !def.walkable && !def.components.firefighting && b.fire === 0
}

export function wellCovers(sim: Simulation, b: Building): boolean {
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  for (const w of sim.buildings.values()) {
    const cfg = sim.component<FirefightingConfig>(w, 'firefighting')
    if (!cfg || w.site) continue
    const dx = w.x + w.w / 2 - cx
    const dy = w.y + w.h / 2 - cy
    if (dx * dx + dy * dy <= cfg.radius * cfg.radius) return true
  }
  return false
}

export function ignite(sim: Simulation, b: Building, def: EventDef): void {
  const covered = wellCovers(sim, b)
  b.fire = covered ? num(def, 'wellBurnSeconds', 10) : num(def, 'burnSeconds', 45)
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
    const candidates = [...sim.buildings.values()].filter(
      (b) => !b.site && burnable(sim, b) && sim.def(b).id !== 'guildhall' && (!component || sim.def(b).components[component]),
    )
    const target = sim.rng.pick(candidates)
    if (!target) return false
    if (component === 'boiler' && target.data.lit !== true) return false
    ignite(sim, target, def)
    sim.notify('bad', `${def.name}! The ${sim.def(target).name} is ablaze.`, target.door)
    return true
  },
})

// ---------------------------------------------------------------- others

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
    const people = [...sim.citizens.values()].filter((c) => c.sick === 0)
    const count = Math.max(1, Math.round(people.length * num(def, 'fraction', 0.1)))
    if (people.length === 0) return false
    for (let n = 0; n < count && people.length; n++) {
      const c = people.splice(sim.rng.int(people.length), 1)[0]
      c.sick = num(def, 'months', 3)
      c.sickRate = num(def, 'healthPerMonth', 0.12)
    }
    sim.notify('bad', `${def.name} is spreading: ${count} citizens have fallen ill.`)
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

registerEvent({
  kind: 'nomads',
  run: (sim, def) => {
    const hall = [...sim.buildings.values()].find((b) => !b.site && sim.def(b).components.shelter)
    if (!hall) return false
    const min = num(def, 'min', 3)
    const total = min + sim.rng.int(Math.max(1, num(def, 'max', 7) - min + 1))
    let arrived = 0
    while (arrived + 2 <= total) {
      const kids = Math.min(total - arrived - 2, sim.rng.int(3))
      const family = spawnFamily(sim, hall.door, kids, 16)
      for (const c of family) {
        c.tools = 0
        sim.emit({ type: 'citizen', id: c.id, change: 'arrived' })
      }
      arrived += family.length
    }
    if (arrived < total) {
      const female = sim.rng.chance(0.5)
      const c = createCitizen(sim, {
        name: `${firstName(sim.rng, female)} ${surname(sim.rng)}`,
        female,
        ageMonths: (17 + sim.rng.int(15)) * 12,
        x: sim.world.xOf(hall.door) + 0.5,
        y: sim.world.yOf(hall.door) + 0.5,
      })
      sim.emit({ type: 'citizen', id: c.id, change: 'arrived' })
      arrived++
    }
    sim.stats.arrivals += arrived
    assignHousing(sim)
    sim.notify('good', `${def.name}: ${arrived} travellers have asked to join the colony.`, hall.door)
    return true
  },
})

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

/** Monthly roll for disasters and blessings, weighted by events.json and scaled by difficulty. */
export function rollEvents(sim: Simulation): void {
  const e = sim.rules.events
  const pick = (disaster: boolean) => {
    const eligible = sim.content.bundle.events.filter(
      (d) => d.disaster === disaster && sim.year >= d.minYear && (!d.seasons || d.seasons.includes(sim.season.id)) && handlers.has(d.kind),
    )
    const index = sim.rng.weighted(eligible.map((d) => d.weight))
    if (index >= 0) handlers.get(eligible[index].kind)!.run(sim, eligible[index])
  }
  if (sim.monthIndex >= e.graceYears * sim.rules.months.length && sim.rng.chance((e.disastersPerYear / 12) * sim.mods.disasterRate)) pick(true)
  if (sim.rng.chance(e.blessingsPerYear / 12)) pick(false)
}

