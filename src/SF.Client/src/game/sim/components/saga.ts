import { airshipYard, telegraphOnline } from '../saga'
import { registerComponent } from './registry'

/** The Airship Yard: expeditions leave from here (see saga.ts and the Hollowmere chart). */
registerComponent<Record<string, never>>({
  kind: 'airshipYard',
  describe: (sim, b) => {
    const away = sim.saga.expeditions.length
    const lines = [airshipYard(sim) === b ? 'Fits out expedition airships: open the Hollowmere chart to send one' : 'Out of action']
    if (away) lines.push(`${away} expedition${away === 1 ? '' : 's'} away`)
    return lines
  },
})

/** The Telegraph Office: keeps the colony in touch with the forges that still answer. */
registerComponent<Record<string, never>>({
  kind: 'telegraph',
  describe: (sim) => {
    const forges = sim.content.bundle.forges?.forges ?? []
    const live = forges.filter((f) => sim.saga.forges[f.id]?.fate === 'answering').length
    const waiting = forges.filter((f) => sim.saga.forges[f.id]?.request).length
    return [
      telegraphOnline(sim) ? `${live} forges answer the telegraph` : 'Silent',
      waiting ? `${waiting} request${waiting === 1 ? '' : 's'} waiting: see the Hollowmere chart` : 'No requests waiting',
    ]
  },
})
