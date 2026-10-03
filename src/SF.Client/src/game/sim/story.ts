import type { Simulation } from './simulation'

export interface StoryState {
  /** Dispatches already received, in order. */
  sent: string[]
}

/**
 * Sends any story dispatch whose trigger is met. Research and building triggers fire on the event itself; year
 * and population triggers are checked monthly (pass no trigger).
 */
export function checkDispatches(sim: Simulation, trigger: { research?: string; building?: string }): void {
  for (const d of sim.content.bundle.story.dispatches) {
    if (sim.story.sent.includes(d.id)) continue
    const w = d.when
    const met =
      (w.research !== undefined && w.research === trigger.research) ||
      (w.building !== undefined && w.building === trigger.building) ||
      (w.year !== undefined && sim.year >= w.year) ||
      (w.population !== undefined && sim.citizens.size >= w.population)
    if (!met) continue
    sim.story.sent.push(d.id)
    sim.notify('story', d.title, undefined, d.id)
  }
}

/** Replaces {colony} with the colony's name. */
export function storyText(text: string, colony: string): string {
  return text.replaceAll('{colony}', colony)
}
