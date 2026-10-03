import { amount, foodIds, total, type StorageConfig } from '../inventory'
import { registerComponent } from './registry'

registerComponent<StorageConfig>({
  kind: 'storage',
  activate: (sim) => sim.invalidateStorages(),
  describe: (_sim, b, cfg) => [`Stored ${Math.floor(total(b.stock))} / ${cfg.capacity}`],
})

export interface HousingConfig {
  capacity: number
  /** Higher insulation burns less firewood. */
  insulation: number
}

registerComponent<HousingConfig>({
  kind: 'housing',
  activate: (sim) => {
    sim.housingDirty = true
  },
  /** Burns firewood while occupied in the cold; a home without fuel is unheated. */
  second: (sim, b, cfg) => {
    const cold = sim.coldness
    if (cold <= 0 || b.residents.length === 0) {
      b.data.heated = true
      return
    }
    const steamHeat = (b.data.heat as number | undefined) ?? 0
    const perMonth = (sim.rules.housing.firewoodPerMonth * cold * 2 * (1 - steamHeat)) / cfg.insulation
    const need = perMonth / sim.rules.secondsPerMonth
    const have = amount(b.stock, 'firewood')
    b.data.heated = have >= need || steamHeat >= 1
    sim.recordConsumed('firewood', Math.min(have, need))
    b.stock.firewood = Math.max(0, have - need)
    if (b.stock.firewood <= 1e-6) delete b.stock.firewood
  },
  describe: (sim, b, cfg) => {
    let food = 0
    for (const f of foodIds(sim)) food += amount(b.stock, f)
    const steamHeat = (b.data.heat as number | undefined) ?? 0
    return [
      `Residents ${b.residents.length} / ${cfg.capacity}`,
      `Pantry: ${Math.floor(food)} food, ${Math.floor(amount(b.stock, 'firewood'))} firewood`,
      b.data.heated === false ? 'Cold: no firewood!' : steamHeat >= 1 ? 'Warm: steam radiators' : 'Warm',
    ]
  },
})

export interface ShelterConfig {
  warmUpPerMonth: number
}

/** Somewhere the homeless can warm up (the Steamforge). Read by the needs system. */
registerComponent<ShelterConfig>({ kind: 'shelter' })

export interface WorkplaceConfig {
  workers: number
  profession: string
}

registerComponent<WorkplaceConfig>({
  kind: 'workplace',
  describe: (sim, b, cfg) => [`Workers ${b.workers.length} / ${b.workerTarget} (max ${sim.maxWorkers(b)})`, `Profession: ${sim.content.professions.get(cfg.profession)?.name ?? cfg.profession}`],
})

export interface FirefightingConfig {
  radius: number
  /** Seconds a covered fire burns before it is put out, when quicker than the event's wellBurnSeconds. */
  burnSeconds?: number
}

/** Buildings within reach of a well (or a steam fire station) have fires put out quickly (see the fire system). */
registerComponent<FirefightingConfig>({
  kind: 'firefighting',
  describe: (_sim, _b, cfg) => [`Fights fires within ${cfg.radius} tiles${cfg.burnSeconds ? `, within ${cfg.burnSeconds}s` : ''}`],
})
