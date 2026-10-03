import { registerEffect } from '../effects'
import { energyBlocked } from '../energy'
import { addStock, available } from '../inventory'
import { createAutomaton } from '../population'
import type { Simulation } from '../simulation'
import { gotoBuilding, reserveStock, task } from '../tasks'
import type { Building, Stock } from '../types'
import { fetchIntoTask, onHand } from '../work'
import { registerComponent } from './registry'

export interface AssemblerConfig {
  /** Parts used for one automaton. */
  inputs: Stock
  /** Work-seconds to assemble one. */
  seconds: number
}

function automatonCount(sim: Simulation): number {
  let n = 0
  for (const c of sim.citizens.values()) if (c.automaton) n++
  return n
}

/** The player's cap on automatons (data.target), defaulting to no cap. */
function target(b: Building): number {
  return typeof b.data.target === 'number' ? b.data.target : Infinity
}

registerEffect('assemble', (sim, _c, [id]) => {
  const b = sim.buildings.get(id)
  const cfg = b ? sim.component<AssemblerConfig>(b, 'assembler') : undefined
  if (!b || !cfg) return false
  for (const [res, qty] of Object.entries(cfg.inputs)) if ((b.stock[res] ?? 0) < qty - 1e-6) return false
  for (const [res, qty] of Object.entries(cfg.inputs)) {
    addStock(b.stock, res, -qty)
    sim.recordConsumed(res, qty)
  }
  const bot = createAutomaton(sim, sim.world.xOf(b.door) + 0.5, sim.world.yOf(b.door) + 0.5)
  sim.recordProduced('automaton', 1)
  sim.emit({ type: 'citizen', id: bot.id, change: 'built' })
  sim.notify('good', `${bot.name} has been wound up and set to work.`, b.door)
  return true
})

/**
 * An automaton works: engineers fetch cogs, copper and iron and assemble clockwork automatons, which join the
 * workforce as laborers. Needs steam; stops at the player's target count.
 */
registerComponent<AssemblerConfig>({
  kind: 'assembler',
  work: (sim, b, cfg, c) => {
    // A pledge to the guilds holds the works idle.
    if (energyBlocked(sim, b) || automatonCount(sim) >= target(b) || sim.monthIndex < sim.noAutomatonsUntil) return null
    const ready = Object.entries(cfg.inputs).every(([res, qty]) => available(b, res) >= qty)
    if (ready) {
      return task('work', 'Assembling an automaton', b.id, [
        gotoBuilding(b, true),
        { op: 'work', seconds: cfg.seconds, effect: 'assemble', args: [b.id], at: b.id },
      ], Object.entries(cfg.inputs).map(([res, qty]) => reserveStock(b, res, qty)))
    }
    for (const [res, qty] of Object.entries(cfg.inputs)) {
      const fetch = fetchIntoTask(sim, c, b, res, qty - (onHand(b, res) - (b.reserved[res] ?? 0)))
      if (fetch) return fetch
    }
    return null
  },
  option: (_sim, b, _cfg, key, value) => {
    if (key !== 'target') return false
    if (value === 'none') {
      delete b.data.target
      return true
    }
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return false
    b.data.target = Math.round(n)
    return true
  },
  describe: (sim, b, cfg) => {
    const parts = Object.entries(cfg.inputs).map(([res, qty]) => `${qty} ${sim.resource(res)?.name.toLowerCase() ?? res}`).join(' + ')
    const cap = target(b)
    const lines = [`One automaton from ${parts}`, `Automatons at work: ${automatonCount(sim)}${Number.isFinite(cap) ? ` (target ${cap})` : ''}`]
    if (energyBlocked(sim, b)) lines.push('Idle: needs steam')
    return lines
  },
})
