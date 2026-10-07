import { describe, expect, it } from 'vitest'
import { runEffect } from './effects'
import { findSpot, footprintSize, placeBuilding } from './placement'
import { Simulation } from './simulation'
import { content, newColony, runMonths, runSeconds } from './testing'
import type { Building } from './types'

/** A finished field with clear ground on every side, so it has room to grow. */
function prebuildField(sim: Simulation, w = 6, h = 6): Building {
  const hq = sim.headquarters()!
  const def = sim.def('crop-field')
  const spot = findSpot(sim, { ...def, placement: {}, size: [w + 6, h + 6] }, hq.x + 14, hq.y, 60, true)!
  return placeBuilding(sim, def, spot.x + 3, spot.y + 3, 0, ...footprintSize(def, 0, w, h), true)
}

const plots = (b: Building) => b.data.plots as number[]
const plotAt = (b: Building, x: number, y: number) => plots(b)[(y - b.y) * b.w + (x - b.x)]

describe('crop fields', () => {
  it('keeps each plot by its ground when resized, and takes up or frees the ground', () => {
    const sim = newColony()
    const field = prebuildField(sim)
    const { x, y } = field
    plots(field)[0] = 1 // the north-west corner
    plots(field)[field.w * field.h - 1] = 1 // the south-east corner

    // Grow two tiles west and north, shrink one from the east.
    expect(sim.perform({ type: 'resize', building: field.id, x: x - 2, y: y - 2, w: 7, h: 8 })).toEqual({ ok: true, building: field.id })
    expect([field.x, field.y, field.w, field.h]).toEqual([x - 2, y - 2, 7, 8])
    expect(plots(field)).toHaveLength(56)
    expect(plotAt(field, x, y)).toBe(1)
    expect(plots(field).filter((p) => p === 1)).toHaveLength(1)
    expect(sim.world.building[sim.world.index(x - 2, y - 2)]).toBe(field.id)
    expect(sim.world.building[sim.world.index(x + 5, y + 5)]).toBe(0)
    expect(field.door).toBe(sim.world.index(field.x + (field.w >> 1), field.y + (field.h >> 1)))
  })

  it('refuses footprints it cannot take', () => {
    const sim = newColony()
    const field = prebuildField(sim)
    const hq = sim.headquarters()!
    const resize = (x: number, y: number, w: number, h: number) => sim.perform({ type: 'resize', building: field.id, x, y, w, h })
    expect(resize(field.x, field.y, 2, 6).ok).toBe(false) // below the minimum
    expect(resize(field.x, field.y, 16, 6).ok).toBe(false) // above the maximum
    expect(resize(field.x + 20, field.y, 6, 6).ok).toBe(false) // a move, not a resize
    expect(resize(field.x, field.y, 6, 6).ok).toBe(false) // unchanged
    expect(sim.perform({ type: 'resize', building: hq.id, x: hq.x, y: hq.y, w: hq.w + 1, h: hq.h }).ok).toBe(false)
    // Another building in the way.
    const other = prebuildField(sim)
    const reach = { x: Math.min(field.x, other.x), y: Math.min(field.y, other.y) }
    const w = Math.max(field.x + field.w, other.x + other.w) - reach.x
    const h = Math.max(field.y + field.h, other.y + other.h) - reach.y
    if (w <= 15 && h <= 15) expect(resize(reach.x, reach.y, w, h)).toEqual({ ok: false, reason: 'Something is already built here.' })
  })

  it('sows plots added while planting, and keeps the phase in step with the plots', () => {
    const sim = newColony()
    const field = prebuildField(sim, 3, 3)
    field.data.plots = plots(field).map(() => 1)
    field.data.phase = 'grow'
    sim.perform({ type: 'resize', building: field.id, x: field.x, y: field.y, w: 4, h: 3 })
    expect(field.data.phase).toBe('plant')
    // Shrinking back to the planted ground carries on growing.
    sim.perform({ type: 'resize', building: field.id, x: field.x, y: field.y, w: 3, h: 3 })
    expect(field.data.phase).toBe('grow')
    // Shrinking away every planted plot leaves the field fallow.
    const ripe = prebuildField(sim, 3, 4)
    ripe.data.plots = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ripe.data.phase = 'harvest'
    expect(sim.perform({ type: 'resize', building: ripe.id, x: ripe.x, y: ripe.y + 1, w: 3, h: 3 }).ok).toBe(true)
    expect(ripe.data.phase).toBe('fallow')
  })

  it('plants by tile, so a task sent out before a resize cannot plant the wrong plot', () => {
    const sim = newColony()
    const field = prebuildField(sim)
    field.data.phase = 'plant'
    const farmer = [...sim.citizens.values()][0]
    const gone = sim.world.index(field.x + 5, field.y) // the north-east corner, index 5
    sim.perform({ type: 'resize', building: field.id, x: field.x, y: field.y, w: 5, h: 6 })
    runEffect('plantPlot', sim, farmer, [field.id, 5, gone])
    expect(plots(field).every((p) => p === 0)).toBe(true)
    runEffect('plantPlot', sim, farmer, [field.id, 5, sim.world.index(field.x, field.y + 1)])
    expect(plotAt(field, field.x, field.y + 1)).toBe(1)
  })

  it('sows a field finished after spring while the crop can still ripen, and only once a year', () => {
    const sim = newColony()
    runMonths(sim, 4) // early summer
    const summer = prebuildField(sim)
    expect(summer.data.phase).toBe('plant')
    // Barley needs five months: too late for it now, so the field waits.
    expect(sim.perform({ type: 'setOption', building: summer.id, key: 'crop', value: 'barley' }).ok).toBe(true)
    expect(summer.data.phase).toBe('fallow')
    // Harvested this year: it rests until spring.
    summer.data.harvested = sim.year
    expect(sim.perform({ type: 'setOption', building: summer.id, key: 'crop', value: 'cabbage' }).ok).toBe(true)
    expect(summer.data.phase).toBe('fallow')
    runMonths(sim, 3) // autumn
    expect(prebuildField(sim).data.phase).toBe('fallow')
  })

  it('survives a save and load after a resize', () => {
    const sim = newColony()
    const field = prebuildField(sim)
    sim.perform({ type: 'resize', building: field.id, x: field.x - 1, y: field.y, w: 8, h: 6 })
    runSeconds(sim, 30)
    const loaded = Simulation.deserialize(content, sim.serialize())
    runSeconds(sim, 60)
    runSeconds(loaded, 60)
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(sim.serialize()))
  })
})
