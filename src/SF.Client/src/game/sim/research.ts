import type { Content } from '../../api/content'
import type { ResearchDef } from '../../api/types'
import type { Simulation } from './simulation'
import { checkDispatches } from './story'

/** Content a research can unlock. Anything no research unlocks is available from the founding. */
export type UnlockKind = 'building' | 'road' | 'network' | 'conduit' | 'recipe'

const lockCache = new WeakMap<Content, Map<string, ResearchDef>>()

/** `${kind}:${id}` -> the research that unlocks it. */
function locks(content: Content): Map<string, ResearchDef> {
  let map = lockCache.get(content)
  if (!map) {
    map = new Map()
    for (const tech of content.bundle.research) {
      const u = tech.unlocks
      for (const id of u.buildings ?? []) map.set(`building:${id}`, tech)
      for (const id of u.roads ?? []) map.set(`road:${id}`, tech)
      for (const id of u.networks ?? []) map.set(`network:${id}`, tech)
      for (const id of u.conduits ?? []) map.set(`conduit:${id}`, tech)
      for (const id of u.recipes ?? []) map.set(`recipe:${id}`, tech)
    }
    lockCache.set(content, map)
  }
  return map
}

/** The research that still has to be completed before this content can be used, or null when it is unlocked. */
export function lockedBy(sim: Simulation, kind: UnlockKind, id: string): ResearchDef | null {
  const tech = locks(sim.content).get(`${kind}:${id}`)
  return tech && !sim.research.done.includes(tech.id) ? tech : null
}

export function isUnlocked(sim: Simulation, kind: UnlockKind, id: string): boolean {
  return lockedBy(sim, kind, id) === null
}

export function isResearched(sim: Simulation, tech: string): boolean {
  return sim.research.done.includes(tech)
}

/** Not yet done, with every requirement done. */
export function canResearch(sim: Simulation, tech: ResearchDef): boolean {
  return !tech.salvage && !isResearched(sim, tech.id) && tech.requires.every((r) => isResearched(sim, r))
}

/** The research itself preceded by every unfinished requirement, requirements first. */
export function researchPlan(sim: Simulation, techId: string): string[] {
  const plan: string[] = []
  const visit = (id: string) => {
    if (isResearched(sim, id) || plan.includes(id)) return
    const tech = sim.content.research.get(id)
    if (!tech) return
    for (const r of tech.requires) visit(r)
    plan.push(id)
  }
  visit(techId)
  return plan
}

export function currentResearch(sim: Simulation): ResearchDef | null {
  const id = sim.research.queue[0]
  return id ? (sim.content.research.get(id) ?? null) : null
}

/** Adds research points to the current project, completing it (and moving on to the next) when it is paid for. */
export function addResearchPoints(sim: Simulation, points: number): void {
  const tech = currentResearch(sim)
  if (!tech) return
  const r = sim.research
  const progress = (r.progress[tech.id] ?? 0) + points
  if (progress < tech.points - 1e-6) {
    r.progress[tech.id] = progress
    return
  }
  delete r.progress[tech.id]
  r.queue.shift()
  r.done.push(tech.id)
  sim.emit({ type: 'research', tech: tech.id })
  const names = unlockNames(sim, tech)
  sim.notify('good', `Research complete: ${tech.name}.${names.length ? ` Unlocked ${names.join(', ')}.` : ''}`)
  if (r.queue.length === 0) sim.notify('info', 'The drafting tables are idle. Choose the next research project.')
  checkDispatches(sim, { research: tech.id })
}

/** Display names of everything a research unlocks. */
export function unlockNames(sim: Simulation, tech: ResearchDef): string[] {
  const u = tech.unlocks
  return [
    ...(u.buildings ?? []).map((id) => sim.content.buildings.get(id)?.name ?? id),
    ...(u.roads ?? []).map((id) => sim.rules.roads.find((r) => r.id === id)?.name ?? id),
    ...(u.networks ?? []).map((id) => sim.rules.networks.find((n) => n.id === id)?.conduit.name ?? id),
    ...(u.conduits ?? []).map((id) => sim.rules.networks.flatMap((n) => n.upgrades ?? []).find((c) => c.id === id)?.name ?? id),
    ...(u.recipes ?? []).map((id) => sim.content.recipes.get(id)?.name ?? id),
  ]
}
