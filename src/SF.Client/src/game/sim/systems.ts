import { chooseTask } from './ai'
import type { ShelterConfig } from './components/basic'
import { solveEnergy } from './energy'
import { rollEvents, updateFires } from './events'
import { computeTotals, foodIds } from './inventory'
import { assignHousing, assignJobs, births, killCitizen } from './population'
import type { Simulation } from './simulation'
import { checkDispatches } from './story'
import { runCitizen } from './tasks'
import { MARK_CLEAR } from './world'

/**
 * A simulation system. Systems run in registration order: tick() every tick, second() once per game second,
 * month() at each month boundary. restore() rebuilds derived caches after loading a save and must not advance
 * state. New mechanics can register additional systems.
 */
export interface SimSystem {
  readonly id: string
  tick?(sim: Simulation): void
  second?(sim: Simulation): void
  month?(sim: Simulation): void
  restore?(sim: Simulation): void
}

export const systems: SimSystem[] = []

export function registerSystem(system: SimSystem, before?: string): void {
  const at = before ? systems.findIndex((s) => s.id === before) : -1
  if (at >= 0) systems.splice(at, 0, system)
  else systems.push(system)
}

// ---------------------------------------------------------------- weather

registerSystem({
  id: 'weather',
  month: (sim) => {
    const jitter = sim.rules.temperatureJitter
    sim.weather.offset = sim.rng.range(-jitter, jitter)
    if (sim.weather.snapMonths > 0) sim.weather.snapMonths--
  },
})

// ---------------------------------------------------------------- citizens (movement and tasks)

registerSystem({
  id: 'citizens',
  tick: (sim) => {
    for (const c of sim.citizens.values()) runCitizen(sim, c, chooseTask)
  },
})

// ---------------------------------------------------------------- needs

registerSystem({
  id: 'needs',
  second: (sim) => {
    const r = sim.rules.citizen
    const spm = sim.rules.secondsPerMonth
    const cold = sim.coldness
    const dead: [number, string][] = []
    for (const c of sim.citizens.values()) {
      c.hunger = Math.max(0, c.hunger - (r.hungerPerMonth * sim.mods.hungerRate) / spm)

      const inside = c.inside ? sim.buildings.get(c.inside) : undefined
      if (cold <= 0) {
        c.warmth = Math.min(1, c.warmth + 1 / spm)
      } else if (inside && inside.id === c.home && inside.data.heated) {
        c.warmth = Math.min(1, c.warmth + r.warmUpPerMonth / spm)
      } else if (inside && sim.def(inside).components.shelter) {
        const cfg = sim.def(inside).components.shelter as ShelterConfig
        c.warmth = Math.min(1, c.warmth + cfg.warmUpPerMonth / spm)
      } else {
        const exposure = inside ? 0.35 : 1
        const coat = c.coat > 0 ? 1 - r.coatProtection : 1
        c.warmth = Math.max(0, c.warmth - (cold * r.coldPerMonth * exposure * coat) / spm)
      }

      let dh = 0
      if (c.hunger <= 0) dh -= r.starvationPerMonth
      if (c.warmth <= 0) dh -= r.freezingPerMonth
      if (c.sick > 0) dh -= c.sickRate
      if (dh === 0) {
        const variety = new Set(c.diet).size
        dh = r.healthRecoveryPerMonth * (0.5 + Math.min(1, variety / 4))
      }
      c.health = Math.max(0, Math.min(1, c.health + dh / spm))
      if (c.health <= 0) dead.push([c.id, c.hunger <= 0 ? 'starvation' : c.warmth <= 0 ? 'cold' : 'sickness'])

      const home = c.home ? sim.buildings.get(c.home) : undefined
      const target =
        0.25 +
        (home ? 0.2 : 0) +
        0.15 * Math.min(1, new Set(c.diet).size / 4) +
        (cold <= 0 || home?.data.heated ? 0.15 : 0) +
        0.15 * c.health +
        (c.hunger > 0.2 ? 0.1 : 0)
      c.happiness += (target - c.happiness) * 0.02
    }
    for (const [id, cause] of dead) {
      const c = sim.citizens.get(id)
      if (c) killCitizen(sim, c, cause)
    }
  },
  month: (sim) => {
    const r = sim.rules.citizen
    const wear = sim.mods.wearRate
    const cold = sim.coldness > 0
    const dead: number[] = []
    for (const c of sim.citizens.values()) {
      c.age++
      if (c.age === r.adultAge * 12 && c.profession === 'child') {
        c.profession = 'laborer'
        sim.jobsDirty = true
        sim.housingDirty = true
      }
      if (c.profession !== 'child') c.tools = Math.max(0, c.tools - wear)
      if (cold) c.coat = Math.max(0, c.coat - wear)
      if (c.sick > 0) {
        c.sick--
        if (c.sick === 0) c.sickRate = 0
      }
      const years = c.age / 12
      if (years >= r.maxAge) dead.push(c.id)
      else if (years > r.elderAge) {
        const k = (years - r.elderAge) / (r.maxAge - r.elderAge)
        if (sim.rng.chance(r.oldAgeDeathPerMonth * k * k)) dead.push(c.id)
      }
    }
    for (const id of dead) {
      const c = sim.citizens.get(id)
      if (c) killCitizen(sim, c, 'age')
    }
  },
})

// ---------------------------------------------------------------- households and jobs

registerSystem({
  id: 'population',
  second: (sim) => {
    if (sim.housingDirty) assignHousing(sim)
    if (sim.jobsDirty || sim.second % 5 === 0) assignJobs(sim)
  },
  month: (sim) => {
    births(sim)
    sim.housingDirty = true
  },
})

// ---------------------------------------------------------------- construction

registerSystem({
  id: 'construction',
  second: (sim) => {
    const world = sim.world
    for (const b of sim.buildings.values()) {
      if (!b.site || b.site.stage !== 'clearing') continue
      let clear = true
      for (let y = b.y; y < b.y + b.h && clear; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const i = world.index(x, y)
          if (world.feature[i] !== 0) {
            clear = false
            if (!(world.mark[i] & MARK_CLEAR)) sim.queueClear(i)
            break
          }
        }
      }
      if (clear) {
        b.site.stage = 'building'
        sim.emit({ type: 'building', id: b.id, change: 'changed' })
      }
    }
  },
})

// ---------------------------------------------------------------- building components

registerSystem({
  id: 'components',
  second: (sim) => {
    for (const b of [...sim.buildings.values()]) {
      if (b.site || !sim.buildings.has(b.id)) continue
      for (const [handler, cfg] of sim.components(b)) handler.second?.(sim, b, cfg)
    }
  },
  month: (sim) => {
    for (const b of [...sim.buildings.values()]) {
      if (b.site || !sim.buildings.has(b.id)) continue
      for (const [handler, cfg] of sim.components(b)) handler.month?.(sim, b, cfg)
    }
  },
})

registerSystem({
  id: 'energy',
  second: (sim) => solveEnergy(sim, true),
  restore: (sim) => {
    sim.energy.dirty = true
    solveEnergy(sim, false)
  },
})

// ---------------------------------------------------------------- storage

registerSystem({
  id: 'storage',
  second: (sim) => {
    sim.totals = computeTotals(sim)
  },
  restore: (sim) => {
    sim.totals = computeTotals(sim)
  },
  month: (sim) => {
    const rate = sim.mods.spoilageRate / 12
    for (const b of sim.buildings.values()) {
      for (const res in b.stock) {
        const spoil = sim.resource(res)?.spoilagePerYear ?? 0
        if (spoil <= 0) continue
        const keep = b.reserved[res] ?? 0
        const lost = Math.max(0, (b.stock[res] - keep) * spoil * rate)
        b.stock[res] -= lost
        sim.recordConsumed(`spoiled:${res}`, lost)
      }
    }
  },
})

// ---------------------------------------------------------------- nature

/** Harvestable features (bushes, mushrooms) bear fruit every month of their ripening seasons. */
export function refreshRipeness(sim: Simulation): void {
  const world = sim.world
  const features = sim.content.bundle.features
  const season = sim.season.id
  for (let i = 0; i < world.size; i++) {
    const code = world.feature[i]
    if (code === 0) continue
    const harvest = features[code - 1].harvest
    if (harvest) world.growth[i] = harvest.ripens.includes(season) ? 1 : 0
  }
}

registerSystem({
  id: 'nature',
  month: (sim) => {
    const world = sim.world
    const features = sim.content.bundle.features
    for (let i = 0; i < world.size; i++) {
      const code = world.feature[i]
      if (code === 0) continue
      const def = features[code - 1]
      if (def.growth) {
        if (world.growth[i] < 255) world.growth[i] = Math.min(255, world.growth[i] + Math.ceil(255 / def.growth.months))
        else if (sim.rng.chance(def.growth.spawnChance)) {
          const x = world.xOf(i) + sim.rng.int(5) - 2
          const y = world.yOf(i) + sim.rng.int(5) - 2
          if (!world.inBounds(x, y)) continue
          const j = world.index(x, y)
          if (world.feature[j] === 0 && world.terrain[j] === 0 && world.building[j] === 0 && world.road[j] === 0 && world.door[j] === 0 && !sim.roadJobs.has(j)) {
            world.feature[j] = code
            world.growth[j] = 8
          }
        }
      }
    }
    refreshRipeness(sim)
    sim.emit({ type: 'feature', tile: -1 })
  },
})

// ---------------------------------------------------------------- fire and events

registerSystem({ id: 'fire', second: updateFires })
registerSystem({ id: 'events', month: rollEvents })
registerSystem({ id: 'story', month: (sim) => checkDispatches(sim, {}) })

// ---------------------------------------------------------------- outcome and warnings

registerSystem({
  id: 'outcome',
  second: (sim) => {
    if (sim.citizens.size === 0 && sim.outcome === 'playing') {
      sim.outcome = 'lost'
      sim.notify('bad', 'The last colonist is gone. The forge fires have gone cold.')
      sim.emit({ type: 'outcome', outcome: 'lost' })
    }
  },
  month: (sim) => {
    const pop = sim.citizens.size
    sim.stats.peakPopulation = Math.max(sim.stats.peakPopulation, pop)
    let food = 0
    for (const f of foodIds(sim)) food += sim.totals[f] ?? 0
    if (pop > 0 && food < pop * sim.rules.citizen.mealSize * 2) sim.notify('warn', 'Food stores are running low.')
    const homeless = sim.population().homeless
    if (homeless > 0 && (sim.coldness > 0 || sim.season.id === 'autumn')) sim.notify('warn', `${homeless} citizens have no home for the cold months.`)
    if (sim.season.id === 'autumn' && (sim.totals.firewood ?? 0) < pop * 2) sim.notify('warn', 'Firewood is short and winter is coming.')
  },
})
