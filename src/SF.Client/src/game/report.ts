import type { Concern, HudState, WorkplaceRow, WorkStatus } from '../state/game'
import { consumerOf, energyBlocked } from './sim/energy'
import { guildMood, guildOfBuilding } from './sim/guilds'
import { monthsOfFood } from './sim/population'
import { currentResearch } from './sim/research'
import type { Simulation } from './sim/simulation'
import type { Building, LedgerMonth } from './sim/types'
import { currentRecipe, type ProducerConfig } from './sim/components/producer'
import { onHand, outputsOf, storageBlocked } from './sim/work'

/**
 * The overseer's report: read-only views of the colony for the management panels. Nothing here mutates the
 * simulation; it only reads state and the monthly ledger.
 */

/** Seconds without work before a staffed workplace counts as idle. */
const IDLE_AFTER = 15

/** How a month's goods moved for one resource: made, used in work and meals, and lost other ways. */
export interface Flow {
  made: number
  used: number
  built: number
  spoiled: number
  exported: number
}

export function flowOf(month: Pick<LedgerMonth, 'made' | 'used'>, res: string): Flow {
  return {
    made: month.made[res] ?? 0,
    used: month.used[res] ?? 0,
    built: month.used[`built:${res}`] ?? 0,
    spoiled: month.used[`spoiled:${res}`] ?? 0,
    exported: month.used[`export:${res}`] ?? 0,
  }
}

/** Everything that left the stores (used, built with, spoiled or exported). */
export function outOf(f: Flow): number {
  return f.used + f.built + f.spoiled + f.exported
}

/** The most of a resource the colony got through in any one of the last `months` months (its hungriest season). */
export function peakUse(ledger: LedgerMonth[], res: string[], months = 12): number {
  let peak = 0
  for (const m of ledger.slice(-months)) {
    let sum = 0
    for (const r of res) sum += outOf(flowOf(m, r))
    peak = Math.max(peak, sum)
  }
  return peak
}

const round = (v: number) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10)

/** Sum of a category's stock in a ledger month. */
export function stockOf(m: LedgerMonth, ids: string[]): number {
  return ids.reduce((s, id) => s + (m.stock[id] ?? 0), 0)
}

/** Stock of resources over the ledger's last `months` months, with today's figure appended. */
export function stockHistory(hud: HudState, ids: string[], months = 12): number[] {
  const now = ids.reduce((s, id) => s + (hud.resources.find((r) => r.id === id)?.amount ?? 0), 0)
  return [...hud.ledger.slice(-months).map((m) => stockOf(m, ids)), now]
}

/** Last month's net change of a resource, and a description of where it went. */
export function lastMonthFlow(hud: HudState, id: string, name: (id: string) => string): { net: number; title: string } | null {
  const last = hud.ledger.at(-1)
  if (!last) return null
  const f = flowOf(last, id)
  const out = outOf(f)
  if (f.made === 0 && out === 0) return { net: 0, title: 'Nothing made or used last month' }
  const parts = [`made ${round(f.made)}`, `used ${round(f.used)}`]
  if (f.built) parts.push(`built with ${round(f.built)}`)
  if (f.spoiled) parts.push(`spoiled ${round(f.spoiled)}`)
  if (f.exported) parts.push(`exported ${round(f.exported)}`)
  return {
    net: f.made - out,
    title: `${name(id)} last month: ${parts.join(', ')}`,
  }
}

export const netClass = (v: number) => (v > 0.05 ? 'net-up' : v < -0.05 ? 'net-down' : '')

/** What a workplace is doing, most pressing first. */
function statusOf(sim: Simulation, b: Building): { status: WorkStatus; detail: string } {
  if (b.fire > 0) return { status: 'burning', detail: 'On fire' }
  const guild = guildOfBuilding(sim, b)
  if (guild && b.workers.length > 0 && guildMood(sim, guild.id) === 'striking') return { status: 'striking', detail: `The ${guild.short} are on strike` }
  if (b.workerTarget === 0) return { status: 'stoodDown', detail: 'Stood down' }
  if (b.workers.length === 0) return { status: 'unstaffed', detail: 'No workers' }
  if (storageBlocked(sim, b))
    return {
      status: 'storesFull',
      detail: 'No storage has room for its goods',
    }
  if (energyBlocked(sim, b)) {
    const nets = Object.keys(consumerOf(sim, b)?.uses ?? {}).map((id) => sim.rules.networks.find((n) => n.id === id)?.name ?? id)
    return {
      status: 'noPower',
      detail: `No ${nets.join(' or ').toLowerCase() || 'power'}`,
    }
  }
  const outputs = outputsOf(sim, b)
  if (outputs.length > 0 && outputs.every((res) => sim.atLimit(res))) return { status: 'atLimit', detail: 'Stores are at their limit' }
  const producer = sim.component<ProducerConfig>(b, 'producer')
  if (producer) {
    const recipe = currentRecipe(sim, b, producer)
    const missing = Object.keys(recipe.inputs).filter((res) => onHand(b, res) <= 0 && (sim.totals[res] ?? 0) < 1)
    if (missing.length)
      return {
        status: 'waiting',
        detail: `Needs ${missing.map((r) => sim.resource(r)?.name.toLowerCase() ?? r).join(', ')}`,
      }
  }
  if (sim.second - b.activeAt > IDLE_AFTER) return { status: 'idle', detail: 'Nothing to do' }
  return { status: 'working', detail: 'Working' }
}

/** Every finished workplace with its crew and what it is doing, grouped by trade. */
export function workplaceRows(sim: Simulation): WorkplaceRow[] {
  const rows: WorkplaceRow[] = []
  for (const b of sim.buildings.values()) {
    const wp = sim.component<{ profession: string }>(b, 'workplace')
    if (!wp || b.site) continue
    const prof = sim.content.professions.get(wp.profession)
    rows.push({
      id: b.id,
      name: sim.def(b).name,
      profession: wp.profession,
      professionName: prof?.name ?? wp.profession,
      color: prof?.color ?? '#888',
      workers: b.workers.length,
      target: b.workerTarget,
      max: sim.maxWorkers(b),
      ...statusOf(sim, b),
    })
  }
  return rows.sort((a, z) => a.professionName.localeCompare(z.professionName) || a.name.localeCompare(z.name) || a.id - z.id)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function listNames(rows: { name: string }[]): string {
  const names = [...new Set(rows.map((r) => r.name))]
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** What the overseer would bring to the governor's attention, most urgent first. */
export function concerns(sim: Simulation, workplaces: WorkplaceRow[]): Concern[] {
  const out: Concern[] = []
  const r = sim.rules.citizen
  const pop = sim.population()
  if (pop.total === 0) return out
  const ledger = sim.stats.ledger

  const food = monthsOfFood(sim)
  if (food < 1)
    out.push({
      level: 'bad',
      text: 'Food will run out within the month. Build fields, hunters or fishers, or trade for food.',
    })
  else if (food < 3)
    out.push({
      level: 'warn',
      text: `Food lasts about ${Math.floor(food)} months.`,
    })

  // Firewood is judged by the hungriest month of the past year, so a mild summer does not hide the winter's need.
  const wood = sim.totals.firewood ?? 0
  const burn = peakUse(ledger, ['firewood'])
  if (burn > 0) {
    const months = wood / burn
    if (months < 1)
      out.push({
        level: 'bad',
        text: `Firewood would last under a month at winter's rate (${Math.round(burn)} a month).`,
      })
    else if (months < 2.5)
      out.push({
        level: 'warn',
        text: `Firewood would last ${months.toFixed(1)} months at winter's rate.`,
      })
  }

  let beds = 0
  let homesBuilding = 0
  for (const b of sim.buildings.values()) {
    const housing = sim.component<{ capacity: number }>(b, 'housing')
    if (!housing) continue
    if (b.site) homesBuilding++
    else beds += housing.capacity
  }
  if (pop.homeless > 0)
    out.push({
      level: sim.coldness > 0 ? 'bad' : 'warn',
      text: `${plural(pop.homeless, 'citizen')} ${pop.homeless === 1 ? 'has' : 'have'} no home.`,
    })
  else if (beds <= pop.total && homesBuilding === 0)
    out.push({
      level: 'info',
      text: 'Every bed is taken: new families will wait for homes to be built.',
    })

  let hungry = 0
  let cold = 0
  let sick = 0
  let workers = 0
  let noTools = 0
  let noCoat = 0
  for (const c of sim.citizens.values()) {
    if (c.automaton) continue
    if (c.hunger < r.hungerThreshold) hungry++
    if (c.warmth < r.warmthThreshold) cold++
    if (c.sick > 0) sick++
    if (c.profession === 'child') continue
    workers++
    if (c.tools <= 0) noTools++
    if (c.coat <= 0) noCoat++
  }
  if (hungry > 0)
    out.push({
      level: 'warn',
      text: `${plural(hungry, 'citizen')} ${hungry === 1 ? 'is' : 'are'} hungry.`,
    })
  if (cold > 0)
    out.push({
      level: 'warn',
      text: `${plural(cold, 'citizen')} ${cold === 1 ? 'is' : 'are'} cold.`,
    })
  if (sick > 0)
    out.push({
      level: 'warn',
      text: `${plural(sick, 'citizen')} ${sick === 1 ? 'has' : 'have'} the fever.`,
    })
  if (noTools > 0 && noTools >= workers / 4)
    out.push({
      level: 'warn',
      text: `${plural(noTools, 'worker')} without tools work at half pace. A blacksmith makes more.`,
    })
  if (noCoat > 0 && noCoat >= workers / 4 && (sim.season.id === 'autumn' || sim.season.id === 'winter'))
    out.push({
      level: 'warn',
      text: `${plural(noCoat, 'worker')} face the cold without a coat. A tailor makes more.`,
    })

  for (const g of sim.content.bundle.guilds) {
    const mood = guildMood(sim, g.id)
    if (mood === 'striking')
      out.push({
        level: 'bad',
        text: `The ${g.name} are on strike. See the Guilds panel for their grievances.`,
      })
    else if (mood === 'workToRule') out.push({ level: 'warn', text: `The ${g.name} are working to rule.` })
  }

  const trouble: [WorkStatus, Concern['level'], (n: string, count: number) => string][] = [
    ['burning', 'bad', (n) => `On fire: ${n}.`],
    ['storesFull', 'warn', (n, k) => `No storage has room for the goods of ${k === 1 ? 'the ' : ''}${n}. Build a warehouse or stockyard.`],
    ['noPower', 'warn', (n) => `Without the energy to work: ${n}.`],
    ['waiting', 'warn', (n) => `Waiting for materials nobody has: ${n}.`],
    ['unstaffed', 'info', (n) => `No workers yet: ${n}.`],
  ]
  for (const [status, level, text] of trouble) {
    const rows = workplaces.filter((w) => w.status === status)
    if (rows.length)
      out.push({
        level,
        text: text(listNames(rows), rows.length),
        building: rows[0].id,
      })
  }

  let laborers = 0
  let builders = 0
  for (const c of sim.citizens.values()) {
    if (c.profession === 'laborer') laborers++
    else if (c.profession === 'builder') builders++
  }
  const open = workplaces.reduce((s, w) => s + Math.max(0, w.target - w.workers), 0)
  if (open > 0 && laborers === 0)
    out.push({
      level: 'info',
      text: `${plural(open, 'post')} wait${open === 1 ? 's' : ''} for workers and no laborer is free to take ${open === 1 ? 'it' : 'them'}.`,
    })

  // Construction held up for want of materials the stores do not hold.
  const short: Record<string, number> = {}
  let sites = 0
  let firstSite = 0
  for (const b of sim.buildings.values()) {
    if (!b.site) continue
    sites++
    if (b.site.stage !== 'building') continue
    const cost = sim.def(b).cost.resources
    for (const res in cost) {
      const missing = cost[res] - (b.site.delivered[res] ?? 0) - (b.site.incoming[res] ?? 0)
      if (missing > 0) {
        short[res] = (short[res] ?? 0) + missing
        firstSite ||= b.id
      }
    }
  }
  const lacking = Object.entries(short).filter(([res, n]) => (sim.totals[res] ?? 0) < n)
  if (lacking.length)
    out.push({
      level: 'warn',
      text: `Construction is short of ${lacking.map(([res, n]) => `${Math.ceil(n - (sim.totals[res] ?? 0))} ${sim.resource(res)?.name.toLowerCase() ?? res}`).join(', ')}.`,
      building: firstSite || undefined,
    })
  if (sites > 0 && builders === 0)
    out.push({
      level: sim.builderTarget === 0 ? 'warn' : 'info',
      text: `${plural(sites, 'building site')} but no builders. Raise builders in the Guilds panel.`,
    })

  const office = [...sim.buildings.values()].find((b) => !b.site && sim.component(b, 'research'))
  if (office && !currentResearch(sim))
    out.push({
      level: 'info',
      text: 'The drafting tables are idle: choose something to research.',
      building: office.id,
    })

  const rank = { bad: 0, warn: 1, info: 2 }
  return out.sort((a, z) => rank[a.level] - rank[z.level])
}
