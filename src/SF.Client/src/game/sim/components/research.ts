import { relicFactor } from '../saga'
import { registerEffect } from '../effects'
import { energyBlocked } from '../energy'
import { addResearchPoints, currentResearch } from '../research'
import { gotoBuilding, task } from '../tasks'
import { registerComponent } from './registry'

export interface ResearchConfig {
  /** Research points per completed work cycle. */
  points: number
  /** Work-seconds per cycle (shortened by work speed, tools and energy boosts). */
  seconds: number
}

registerEffect('research', (sim, _c, [id]) => {
  const b = sim.buildings.get(id)
  const cfg = b ? sim.component<ResearchConfig>(b, 'research') : undefined
  if (!b || !cfg) return false
  addResearchPoints(sim, cfg.points * relicFactor(sim, 'research'))
  return true
})

/** Engineers at drafting tables (or an analytical engine) put points into the colony's current research. */
registerComponent<ResearchConfig>({
  kind: 'research',
  work: (sim, b, cfg) => {
    const tech = currentResearch(sim)
    if (!tech || energyBlocked(sim, b)) return null
    return task('work', `Researching ${tech.name.toLowerCase()}`, b.id, [
      gotoBuilding(b, true),
      { op: 'work', seconds: cfg.seconds, effect: 'research', args: [b.id], at: b.id },
    ])
  },
  describe: (sim, _b, cfg) => {
    const tech = currentResearch(sim)
    const lines = [`${cfg.points} research point${cfg.points === 1 ? '' : 's'} per ${cfg.seconds}s of work`]
    if (tech) lines.push(`Researching ${tech.name}: ${Math.floor(sim.research.progress[tech.id] ?? 0)} / ${tech.points}`)
    else lines.push('No research chosen: open the Research panel')
    return lines
  },
})
