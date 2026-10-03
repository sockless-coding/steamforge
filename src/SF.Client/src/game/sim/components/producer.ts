import type { RecipeDef } from '../../../api/types'
import { registerEffect } from '../effects'
import { energyBlocked } from '../energy'
import { addStock, available } from '../inventory'
import { isUnlocked } from '../research'
import type { Simulation } from '../simulation'
import { gotoBuilding, reserveStock, task } from '../tasks'
import type { Building } from '../types'
import { fetchIntoTask, haulOutputTask, onHand, outputFull } from '../work'
import { registerComponent } from './registry'

export interface ProducerConfig {
  recipes: string[]
}

/** The chosen recipe, or the first one research has unlocked. */
export function currentRecipe(sim: Simulation, b: Building, cfg: ProducerConfig): RecipeDef {
  const id = (b.data.recipe as string | undefined) ?? cfg.recipes[0]
  const chosen = sim.content.recipes.get(id)
  if (chosen && isUnlocked(sim, 'recipe', chosen.id)) return chosen
  const first = cfg.recipes.find((r) => isUnlocked(sim, 'recipe', r)) ?? cfg.recipes[0]
  return sim.content.recipes.get(first)!
}

registerEffect('produce', (sim, _c, [id, recipeIndex]) => {
  const b = sim.buildings.get(id)
  const recipe = sim.content.bundle.recipes[recipeIndex]
  if (!b || !recipe) return false
  // The inputs were reserved when the task began; the task's reservations are released when it ends.
  for (const [res, qty] of Object.entries(recipe.inputs)) {
    if ((b.stock[res] ?? 0) < qty - 1e-6) return false
  }
  for (const [res, qty] of Object.entries(recipe.inputs)) {
    addStock(b.stock, res, -qty)
    sim.recordConsumed(res, qty)
  }
  for (const [res, qty] of Object.entries(recipe.outputs)) {
    addStock(b.stock, res, qty)
    sim.recordProduced(res, qty)
  }
  return true
})

registerComponent<ProducerConfig>({
  kind: 'producer',
  activate: (_sim, b, cfg) => {
    b.data.recipe ??= cfg.recipes[0]
  },
  outputs: (sim, b, cfg) => Object.keys(currentRecipe(sim, b, cfg).outputs),
  work: (sim, b, cfg, c) => {
    const recipe = currentRecipe(sim, b, cfg)
    const carry = sim.rules.citizen.carry
    if (outputFull(sim, b)) return haulOutputTask(sim, c, b, 1)
    if (energyBlocked(sim, b)) return haulOutputTask(sim, c, b, 1)
    if (Object.keys(recipe.outputs).every((res) => sim.atLimit(res))) return haulOutputTask(sim, c, b, 1)

    const haul = haulOutputTask(sim, c, b, carry)
    if (haul) return haul

    const ready = Object.entries(recipe.inputs).every(([res, qty]) => available(b, res) >= qty)
    if (ready) {
      const index = sim.content.bundle.recipes.indexOf(recipe)
      return task('work', recipe.name, b.id, [
        gotoBuilding(b, true),
        { op: 'work', seconds: recipe.seconds, effect: 'produce', args: [b.id, index], at: b.id },
      ], Object.entries(recipe.inputs).map(([res, qty]) => reserveStock(b, res, qty)))
    }

    const batches = sim.rules.workplace.inputBatches
    for (const [res, qty] of Object.entries(recipe.inputs)) {
      const want = qty * batches - (onHand(b, res) - (b.reserved[res] ?? 0))
      const fetch = fetchIntoTask(sim, c, b, res, want)
      if (fetch) return fetch
    }
    return haulOutputTask(sim, c, b, 1)
  },
  option: (sim, b, cfg, key, value) => {
    if (key !== 'recipe' || !cfg.recipes.includes(value) || !sim.content.recipes.has(value) || !isUnlocked(sim, 'recipe', value)) return false
    b.data.recipe = value
    return true
  },
  describe: (sim, b, cfg) => {
    const recipe = currentRecipe(sim, b, cfg)
    const fmt = (stock: Record<string, number>) =>
      Object.entries(stock).map(([res, qty]) => `${qty} ${sim.resource(res)?.name ?? res}`).join(' + ')
    const lines = [`${recipe.name}: ${fmt(recipe.inputs)} → ${fmt(recipe.outputs)}`]
    const missing = Object.keys(recipe.inputs).filter((res) => onHand(b, res) <= 0)
    if (missing.length) lines.push(`Waiting for ${missing.map((r) => sim.resource(r)?.name ?? r).join(', ')}`)
    return lines
  },
})
