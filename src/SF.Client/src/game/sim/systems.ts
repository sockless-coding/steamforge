import { chooseTask } from './ai'
import { amenityByHome } from './components/amenity'
import { clinicByHome } from './components/health'
import type { ShelterConfig } from './components/basic'
import { solveEnergy } from './energy'
import { rollEvents, updateFires, updatePetition } from './events'
import { updateGuildPetition, updateGuilds } from './guilds'
import { computeTotals, foodIds } from './inventory'
import { assignHousing, assignJobs, births, killCitizen } from './population'
import type { Simulation } from './simulation'
import { fadeGrime, shiftWind, sootExposure, updateSoot } from './soot'
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
    shiftWind(sim)
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
    const amenity = amenityByHome(sim)
    const clinic = clinicByHome(sim)
    const soot = sim.rules.soot
    for (const c of sim.citizens.values()) {
      // Automatons have no needs; their mainspring is wound monthly below.
      if (c.automaton) continue
      c.hunger = Math.max(0, c.hunger - (r.hungerPerMonth * sim.mods.hungerRate) / spm)

      const inside = c.inside ? sim.buildings.get(c.inside) : undefined
      if (cold <= 0) {
        // Mild weather warms people up at a third of a heated home's pace.
        c.warmth = Math.min(1, c.warmth + r.warmUpPerMonth / 3 / spm)
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

      // Coal smoke in the air they breathe, eased by an apothecary's tonics at home.
      const home = c.home ? sim.buildings.get(c.home) : undefined
      const breathing = sootExposure(sim, c.x, c.y)
      const vulnerable = c.age < r.adultAge * 12 || c.age >= r.elderAge * 12
      const lungs =
        Math.max(0, (breathing - soot.lungSafe) / (1 - soot.lungSafe)) *
        soot.lungDamagePerMonth *
        (vulnerable ? soot.vulnerableFactor : 1) *
        (1 - (home ? (clinic.get(home.id) ?? 0) : 0))

      let dh = 0
      if (c.hunger <= 0) dh -= r.starvationPerMonth
      if (c.warmth <= 0) dh -= r.freezingPerMonth
      if (c.sick > 0) dh -= c.sickRate
      if (lungs > 0.002) dh -= lungs
      if (dh === 0) {
        const variety = new Set(c.diet).size
        dh = r.healthRecoveryPerMonth * (0.5 + Math.min(1, variety / 4))
      }
      c.health = Math.max(0, Math.min(1, c.health + dh / spm))
      if (c.health <= 0) dead.push([c.id, c.hunger <= 0 ? 'starvation' : c.warmth <= 0 ? 'cold' : c.sick > 0 ? 'sickness' : 'soot'])

      const smoke = home ? sootExposure(sim, home.x + home.w / 2, home.y + home.h / 2) : breathing
      const target =
        0.25 +
        (home ? 0.2 : 0) +
        0.15 * Math.min(1, new Set(c.diet).size / 4) +
        (cold <= 0 || home?.data.heated ? 0.15 : 0) +
        0.15 * c.health +
        (c.hunger > 0.2 ? 0.1 : 0) +
        (home ? (amenity.get(home.id) ?? 0) : 0) -
        soot.happinessPenalty * smoke
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
    const worn: number[] = []
    const a = sim.rules.automaton
    for (const c of sim.citizens.values()) {
      if (c.automaton) {
        c.age++
        c.wind = Math.max(0, (c.wind ?? 0) - 1)
        if (c.wind === 0) sim.notify('warn', `${c.name} has run down. Keep coal in storage so automatons can be wound.`, sim.world.index(Math.floor(c.x), Math.floor(c.y)))
        const service = (c.age - r.adultAge * 12) / 12 / a.lifeYears
        if (service >= 1.3 || (service > 0.75 && sim.rng.chance(0.05 * service * service))) worn.push(c.id)
        continue
      }
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
    for (const id of worn) {
      const c = sim.citizens.get(id)
      if (c) killCitizen(sim, c, 'wear')
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

// ---------------------------------------------------------------- soot and wind

registerSystem({ id: 'soot', second: updateSoot, month: fadeGrime })

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
registerSystem({ id: 'events', second: updatePetition, month: rollEvents })
registerSystem({ id: 'story', month: (sim) => checkDispatches(sim, {}) })
registerSystem({ id: 'guilds', second: updateGuildPetition, month: updateGuilds })

// ---------------------------------------------------------------- outcome and warnings

registerSystem({
  id: 'outcome',
  second: (sim) => {
    // Automatons cannot carry on a colony alone.
    if (sim.population().total === 0 && sim.outcome === 'playing') {
      sim.outcome = 'lost'
      sim.notify('bad', 'The last colonist is gone. The forge fires have gone cold.')
      sim.emit({ type: 'outcome', outcome: 'lost' })
    }
  },
  // Warnings come at the turn of each season, or every month once they are urgent, so they do not drown other news.
  month: (sim) => {
    const r = sim.rules.citizen
    const pop = sim.population().total
    sim.stats.peakPopulation = Math.max(sim.stats.peakPopulation, pop)
    const seasonStart = sim.season.months[0] === sim.month
    let food = 0
    for (const f of foodIds(sim)) food += sim.totals[f] ?? 0
    const monthsOfFood = pop > 0 ? food / (pop * r.mealSize * r.hungerPerMonth * sim.mods.hungerRate) : Infinity
    if (monthsOfFood < 1) sim.notify('warn', 'Food stores will run out within the month.')
    else if (monthsOfFood < 3 && seasonStart) sim.notify('warn', 'Food stores are running low.')
    const homeless = sim.population().homeless
    const coldAhead = sim.season.id === 'autumn' || sim.season.id === 'winter'
    if (homeless > 0 && coldAhead && seasonStart) sim.notify('warn', `${homeless} citizens have no home for the cold months.`)
    if (sim.season.id === 'autumn' && seasonStart && (sim.totals.firewood ?? 0) < pop * 2) sim.notify('warn', 'Firewood is short and winter is coming.')
  },
})
