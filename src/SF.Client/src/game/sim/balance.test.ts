import { describe, it } from 'vitest'
import { autoplay } from './autoplay'
import { newColony } from './testing'

/**
 * Balance report (opt-in: BALANCE=1 npm run test -- balance). Plays the scripted build order on several seeds and
 * prints average population, births, arrivals and deaths per year, to compare tuning changes. Not an assertion:
 * a single seed is too noisy to judge balance by.
 */
describe.skipIf(!process.env.BALANCE)('balance report', () => {
  it('Engineer colonies over twelve years', () => {
    const seeds = (process.env.BALANCE_SEEDS ?? '11,23,37,41,53,67,79,97').split(',').map(Number)
    const difficulty = process.env.BALANCE_DIFFICULTY ?? 'engineer'
    const years = Number(process.env.BALANCE_YEARS ?? 12)
    const pop: number[][] = []
    const totals = { births: 0, arrivals: 0, deaths: {} as Record<string, number>, lost: 0 }
    for (const seed of seeds) {
      const sim = newColony({ seed, mapSize: 'medium', difficulty })
      const player = autoplay(sim)
      const row: number[] = []
      for (let y = 0; y < years; y++) {
        if (sim.outcome === 'playing') player.playYear()
        row.push(sim.population().total)
      }
      pop.push(row)
      totals.births += sim.stats.births
      totals.arrivals += sim.stats.arrivals
      for (const [cause, n] of Object.entries(sim.stats.deathsBy)) totals.deaths[cause] = (totals.deaths[cause] ?? 0) + n
      if (sim.outcome === 'lost') totals.lost++
    }
    const n = seeds.length
    const avg = (y: number) => (pop.reduce((s, r) => s + r[y], 0) / n).toFixed(1)
    console.log(`${difficulty}, ${n} seeds, ${years} years`)
    console.log(`population by year: ${Array.from({ length: years }, (_, y) => avg(y)).join(' ')}`)
    console.log(`final range: ${Math.min(...pop.map((r) => r[years - 1]))}-${Math.max(...pop.map((r) => r[years - 1]))}, colonies lost: ${totals.lost}`)
    const per = (v: number) => (v / n / years).toFixed(2)
    const deaths = Object.entries(totals.deaths).map(([k, v]) => `${k} ${per(v)}`).join(', ')
    console.log(`per colony-year: births ${per(totals.births)}, arrivals ${per(totals.arrivals)}, deaths: ${deaths || 'none'}`)
  }, 600_000)
})
