import { energyBlocked } from '../energy'
import { amount, available, nearestStorageWith, total } from '../inventory'
import type { Simulation } from '../simulation'
import { gotoBuilding, reserveIncoming, reserveStock, task } from '../tasks'
import type { Building } from '../types'
import { registerComponent } from './registry'

export interface AirshipConfig {
  /** Months between Company airship calls. */
  visitMonths: number
  /** Most units of imports one airship brings. */
  cargo: number
  /** Seconds the airship spends approaching, moored, and departing. */
  approachSeconds: number
  staySeconds: number
  /** Export goods the mast's counting house accepts before the next call clears them. */
  capacity: number
}

export type ShipPhase = 'away' | 'arriving' | 'moored' | 'leaving'

/** Exports are credited on delivery; imports wait in the mast's stock until laborers haul them to storage. */
function exportValue(sim: Simulation, res: string): number {
  return (sim.resource(res)?.value ?? 0) * sim.rules.trade.sellFactor
}

function importPrice(sim: Simulation, res: string): number {
  return (sim.resource(res)?.value ?? 0) * sim.rules.trade.buyFactor
}

function isImport(sim: Simulation, res: string): boolean {
  return sim.trade[res]?.mode === 'import'
}

/** Buys import orders with Company credit, up to the airship's cargo. */
function unloadImports(sim: Simulation, b: Building, cfg: AirshipConfig): string[] {
  let room = cfg.cargo
  const bought: string[] = []
  for (const [res, order] of Object.entries(sim.trade)) {
    if (order.mode !== 'import' || room < 1) continue
    const have = (sim.totals[res] ?? 0) + amount(b.stock, res)
    const price = importPrice(sim, res)
    const qty = Math.floor(Math.min(order.amount - have, room, price > 0 ? sim.credit / price : 0))
    if (qty < 1) continue
    sim.credit -= qty * price
    b.stock[res] = amount(b.stock, res) + qty
    room -= qty
    sim.recordProduced(res, qty)
    bought.push(`${qty} ${sim.resource(res)!.name.toLowerCase()}`)
  }
  return bought
}

/**
 * An airship mast: the colony's trading post with the Meridian Steam Company. Laborers carry export goods here,
 * where they are credited at once; every few months a Company airship moors and unloads the import orders that
 * the colony's credit can pay for. The mooring winches need steam.
 */
registerComponent<AirshipConfig>({
  kind: 'airship',
  activate: (_sim, b, cfg) => {
    b.data.ship = 'away'
    b.data.shipT = 0
    b.data.nextVisit = Math.min(1, cfg.visitMonths)
  },
  second: (sim, b, cfg) => {
    // Exports delivered since the last second become credit.
    for (const res of Object.keys(b.stock)) {
      if (isImport(sim, res)) continue
      const qty = Math.max(0, amount(b.stock, res) - amount(b.reserved, res))
      if (qty <= 0) continue
      sim.credit += qty * exportValue(sim, res)
      sim.recordConsumed(`export:${res}`, qty)
      b.stock[res] -= qty
      if (b.stock[res] <= 1e-6) delete b.stock[res]
    }
    const phase = b.data.ship as ShipPhase
    if (phase === 'away') return
    b.data.shipT = (b.data.shipT as number) + 1
    b.activeAt = sim.second
    const t = b.data.shipT as number
    if (phase === 'arriving' && t >= cfg.approachSeconds) {
      b.data.ship = 'moored'
      b.data.shipT = 0
      const bought = unloadImports(sim, b, cfg)
      sim.notify('good', bought.length ? `The Company airship has moored and unloaded ${bought.join(', ')}.` : 'The Company airship has moored, but the colony ordered nothing it could pay for.', b.door)
    } else if (phase === 'moored' && t >= cfg.staySeconds) {
      b.data.ship = 'leaving'
      b.data.shipT = 0
    } else if (phase === 'leaving' && t >= cfg.approachSeconds) {
      b.data.ship = 'away'
      b.data.shipT = 0
    }
  },
  month: (sim, b, cfg) => {
    if (b.data.ship !== 'away' || energyBlocked(sim, b)) return
    b.data.nextVisit = (b.data.nextVisit as number) - 1
    if ((b.data.nextVisit as number) > 0) return
    b.data.nextVisit = cfg.visitMonths
    b.data.ship = 'arriving'
    b.data.shipT = 0
  },
  outputs: (sim, b) => Object.keys(b.stock).filter((res) => isImport(sim, res)),
  /** Laborers carry surplus to the mast for any resource marked for export. */
  labor: (sim, b, cfg) => {
    if (energyBlocked(sim, b)) return null
    if (total(b.incoming) >= cfg.capacity) return null
    for (const [res, order] of Object.entries(sim.trade)) {
      if (order.mode !== 'export') continue
      const surplus = (sim.totals[res] ?? 0) - order.amount - amount(b.incoming, res)
      if (surplus < 1) continue
      const source = nearestStorageWith(sim, res, b.door)
      if (!source) continue
      const qty = Math.min(surplus, sim.rules.citizen.carry, available(source, res))
      if (qty < 1) continue
      return task('labor', `Carrying ${sim.resource(res)?.name.toLowerCase() ?? res} for export`, b.id, [
        gotoBuilding(source),
        { op: 'take', from: source.id, res, qty },
        gotoBuilding(b),
        { op: 'give', to: b.id },
      ], [reserveStock(source, res, qty), reserveIncoming(b, res, qty)])
    }
    return null
  },
  describe: (sim, b, cfg) => {
    const phase = b.data.ship as ShipPhase
    const lines = [`Company credit: ${Math.floor(sim.credit)}`]
    if (energyBlocked(sim, b)) lines.push('Idle: the mooring winches need steam')
    else if (phase === 'away') lines.push(`Next airship in ${b.data.nextVisit} month${b.data.nextVisit === 1 ? '' : 's'} (every ${cfg.visitMonths})`)
    else lines.push(phase === 'moored' ? 'The airship is moored' : phase === 'arriving' ? 'An airship is approaching' : 'The airship is casting off')
    const orders = Object.entries(sim.trade)
    if (orders.length === 0) lines.push('No trade orders: set them in the Stores panel')
    else lines.push(orders.map(([res, o]) => `${o.mode === 'export' ? 'Exporting' : 'Importing'} ${sim.resource(res)?.name ?? res} (${o.mode === 'export' ? 'above' : 'up to'} ${o.amount})`).join(' · '))
    return lines
  },
})
