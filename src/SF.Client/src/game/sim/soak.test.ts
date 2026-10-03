import { describe, expect, it } from 'vitest'
import { autoplay } from './autoplay'
import type { Simulation } from './simulation'
import { newColony } from './testing'

function summary(sim: Simulation): string {
  const t = sim.totals
  const food = sim.content.bundle.resources.filter((r) => r.category === 'food').reduce((s, r) => s + (t[r.id] ?? 0), 0)
  const p = sim.population()
  return `research ${sim.research.done.join('/')} y${sim.year} m${sim.month} pop ${p.total} (a${p.adults} c${p.children} e${p.elders} homeless ${p.homeless}) food ${Math.round(food)} wood ${Math.round(t.firewood ?? 0)} logs ${Math.round(t.logs ?? 0)} stone ${Math.round(t.stone ?? 0)} tools ${Math.round(t.tools ?? 0)} deaths ${JSON.stringify(sim.stats.deathsBy)} births ${sim.stats.births} arrivals ${sim.stats.arrivals} buildings ${sim.buildings.size}
   produced ${JSON.stringify(Object.fromEntries(Object.entries(sim.stats.produced).map(([k, v]) => [k, Math.round(v)])))}
   consumed ${JSON.stringify(Object.fromEntries(Object.entries(sim.stats.consumed).map(([k, v]) => [k, Math.round(v)])))}`
}

describe('soak', () => {
  it('an Engineer colony with a sensible build order survives ten years', () => {
    const sim = newColony({ seed: 2024, mapSize: 'medium' })
    const player = autoplay(sim)
    const started = Date.now()
    for (let year = 0; year < 10 && sim.outcome === 'playing'; year++) {
      player.playYear()
      console.log(summary(sim))
      if (process.env.SOAK_NOTICES) console.log(sim.notices.filter((n) => n.level === 'bad' || n.level === 'warn').map((n) => n.text).join(' | '))
    }
    console.log(`soak took ${Date.now() - started} ms`)
    expect(sim.outcome).toBe('playing')
    expect(sim.citizens.size).toBeGreaterThan(10)
    expect(sim.research.done).toContain('metallurgy')
  }, 300_000)
})
