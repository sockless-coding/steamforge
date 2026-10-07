import type { Simulation } from '../simulation'
import type { Building, Citizen, Task } from '../types'

/**
 * Behaviour for one component kind. A building definition lists components by kind with a config object
 * (see buildings.json); every hook is optional. Adding a mechanic = writing a handler and registering it here,
 * then using the kind in content. Handlers must stay deterministic (use sim.rng, never Math.random).
 */
export interface ComponentHandler<C = unknown> {
  readonly kind: string
  /** Construction finished, or the building was created prebuilt. */
  activate?(sim: Simulation, b: Building, cfg: C): void
  /** A variable-size building (a field) was resized; `old` is its previous footprint. */
  resize?(sim: Simulation, b: Building, cfg: C, old: { x: number; y: number; w: number; h: number }): void
  /** The building is about to be removed (demolished, burned down). */
  remove?(sim: Simulation, b: Building, cfg: C): void
  /** Next task for a worker employed here, or null if nothing needs doing right now. */
  work?(sim: Simulation, b: Building, cfg: C, citizen: Citizen): Task | null
  /** A task any laborer may take on for this building (such as fuelling the Steamforge), or null. */
  labor?(sim: Simulation, b: Building, cfg: C, citizen: Citizen): Task | null
  /** Resources this building produces into its own stock (hauled to storage by workers and laborers). */
  outputs?(sim: Simulation, b: Building, cfg: C): string[]
  /** Default worker target when construction completes. */
  workers?(sim: Simulation, b: Building, cfg: C): number
  second?(sim: Simulation, b: Building, cfg: C): void
  month?(sim: Simulation, b: Building, cfg: C): void
  /** Player option such as a field's crop. Returns false if the key/value is not accepted. */
  option?(sim: Simulation, b: Building, cfg: C, key: string, value: string): boolean
  /** Short status lines for the inspector panel. */
  describe?(sim: Simulation, b: Building, cfg: C): string[]
}

const handlers = new Map<string, ComponentHandler>()

export function registerComponent<C>(handler: ComponentHandler<C>): void {
  handlers.set(handler.kind, handler as ComponentHandler)
}

export function componentHandler(kind: string): ComponentHandler | undefined {
  return handlers.get(kind)
}

export function knownComponents(): string[] {
  return [...handlers.keys()]
}
