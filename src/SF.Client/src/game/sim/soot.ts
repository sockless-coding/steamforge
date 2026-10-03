import { decodeArray, encodeArray } from './codec'
import { gridOf, generatorOf } from './energy'
import { Rng } from './rng'
import type { Simulation } from './simulation'
import type { Building } from './types'

export interface EmitterConfig {
  /** Soot per second while the building works (generators: while lit, scaled by load, banked fires a quarter). */
  soot: number
  /** Chimney height in tiles: the smoke comes down this far downwind of the building. */
  stack?: number
}

export interface ScrubberConfig {
  /** Cells whose centre lies within this many tiles are cleaned. */
  radius: number
  /** Share of soot removed per second at full power. */
  rate: number
}

export interface SootSnapshot {
  soot: string
  grime: string
}

/**
 * Coal smoke over the colony: a coarse field of airborne soot (one cell per cellSize² tiles) that chimneys and
 * stoves feed, the wind carries and spreads, forests filter, and that settles as lasting grime on the ground. Both
 * layers are saved; forest cover is derived from the map each second.
 */
export class SootField {
  readonly cell: number
  readonly cols: number
  readonly rows: number
  soot: Float32Array
  grime: Float32Array
  /** Tree cover per cell (0-1). Derived. */
  readonly forest: Float32Array
  private scratch: Float32Array

  constructor(width: number, height: number, cell: number) {
    this.cell = Math.max(1, Math.round(cell))
    this.cols = Math.ceil(width / this.cell)
    this.rows = Math.ceil(height / this.cell)
    const n = this.cols * this.rows
    this.soot = new Float32Array(n)
    this.grime = new Float32Array(n)
    this.forest = new Float32Array(n)
    this.scratch = new Float32Array(n)
  }

  /** Cell index for a point in tile space (clamped to the map). */
  cellAt(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell)))
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell)))
    return cy * this.cols + cx
  }

  /** Adds soot at a point in tile space, shared bilinearly between the four nearest cells. */
  add(x: number, y: number, qty: number): void {
    const fx = x / this.cell - 0.5
    const fy = y / this.cell - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const ax = fx - x0
    const ay = fy - y0
    this.addCell(x0, y0, qty * (1 - ax) * (1 - ay))
    this.addCell(x0 + 1, y0, qty * ax * (1 - ay))
    this.addCell(x0, y0 + 1, qty * (1 - ax) * ay)
    this.addCell(x0 + 1, y0 + 1, qty * ax * ay)
  }

  private addCell(cx: number, cy: number, qty: number): void {
    if (qty <= 0) return
    // Smoke that would land off the map stays at its edge.
    cx = Math.max(0, Math.min(this.cols - 1, cx))
    cy = Math.max(0, Math.min(this.rows - 1, cy))
    this.soot[cy * this.cols + cx] += qty
  }

  private sample(src: Float32Array, fx: number, fy: number): number {
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const ax = fx - x0
    const ay = fy - y0
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= this.cols || y >= this.rows ? 0 : src[y * this.cols + x])
    return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay
  }

  /** One second of weather: carry soot downwind, spread it, let it disperse and settle. Soot blown off the map is gone. */
  step(windX: number, windY: number, diffusion: number, decay: number, forestDecay: number, deposit: number): void {
    const { cols, rows } = this
    const src = this.soot
    const out = this.scratch
    const vx = windX / this.cell
    const vy = windY / this.cell
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) out[y * cols + x] = this.sample(src, x - vx, y - vy)
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const c = out[i]
        const l = x > 0 ? out[i - 1] : 0
        const r = x < cols - 1 ? out[i + 1] : 0
        const u = y > 0 ? out[i - cols] : 0
        const d = y < rows - 1 ? out[i + cols] : 0
        let v = c + diffusion * (l + r + u + d - 4 * c)
        v *= 1 - Math.min(1, decay + forestDecay * this.forest[i])
        const settle = v * deposit
        this.grime[i] += settle
        src[i] = v - settle < 1e-5 ? 0 : v - settle
      }
    }
  }

  /** Total airborne soot. */
  total(): number {
    let sum = 0
    for (let i = 0; i < this.soot.length; i++) sum += this.soot[i]
    return sum
  }

  serialize(): SootSnapshot {
    return { soot: encodeArray(this.soot), grime: encodeArray(this.grime) }
  }

  load(s: SootSnapshot | undefined): void {
    if (!s) return
    const soot = decodeArray(s.soot, Float32Array)
    const grime = decodeArray(s.grime, Float32Array)
    if (soot.length === this.soot.length) this.soot = soot
    if (grime.length === this.grime.length) this.grime = grime
  }
}

/** Airborne soot at a point in tile space, as exposure: 0 for clean air, 1 at rules.soot.fullSoot or more. */
export function sootExposure(sim: Simulation, x: number, y: number): number {
  return Math.min(1, sim.soot.soot[sim.soot.cellAt(x, y)] / sim.rules.soot.fullSoot)
}

/** Settled grime at a point in tile space: 0 for clean ground, 1 when fully fouled. */
export function grimeLevel(sim: Simulation, x: number, y: number): number {
  return Math.min(1, sim.soot.grime[sim.soot.cellAt(x, y)] / sim.rules.soot.fullGrime)
}

/** Unit vector the wind blows towards, and its speed in tiles per second. */
export function windVector(sim: Simulation): { x: number; y: number; speed: number } {
  const w = sim.weather
  const speed = Math.sqrt(w.windX * w.windX + w.windY * w.windY)
  return speed > 0 ? { x: w.windX / speed, y: w.windY / speed, speed } : { x: 0, y: 0, speed: 0 }
}

/** Compass degrees (0 = north, the -y edge of the map) the wind blows from. */
export function windFrom(sim: Simulation): number {
  const v = windVector(sim)
  if (v.speed === 0) return 0
  return (((Math.atan2(-v.x, v.y) * 180) / Math.PI) + 360) % 360
}

/** Sets the wind blowing from a compass bearing at a speed (tiles per second). */
export function setWind(sim: Simulation, fromDegrees: number, speed: number): void {
  const rad = (fromDegrees * Math.PI) / 180
  // Blowing from the north (0°) carries soot south, towards +y.
  sim.weather.windX = -Math.sin(rad) * speed
  sim.weather.windY = Math.cos(rad) * speed
}

/**
 * A new month brings a new wind near the season's prevailing direction. The wind draws from its own generator,
 * seeded by the colony and the month, so it needs no saved state and leaves the colony's random sequence alone.
 */
export function shiftWind(sim: Simulation): void {
  const w = sim.rules.wind
  const rng = new Rng((Math.imul(sim.options.seed ^ 0x5bd1e995, 0x27d4eb2d) + Math.imul(sim.monthIndex + 1, 0x165667b1)) >>> 0)
  const from = (w.prevailing[sim.season.id] ?? 0) + rng.range(-w.variance, w.variance)
  setWind(sim, from, rng.range(w.speed[0], w.speed[1]))
}

/** How hard a building's chimneys are drawing right now (0 when cold). */
export function emitterLoad(sim: Simulation, b: Building): number {
  if (b.site || b.fire > 0) return 0
  const gen = generatorOf(sim, b)
  if (gen) {
    if (b.data.lit !== true) return 0
    const grid = gridOf(sim, b, gen.network)
    const load = grid && grid.supply > 0 ? Math.min(1, grid.demand / grid.supply) : 0
    return Math.max(0.25, load)
  }
  return sim.second - b.activeAt <= 1 ? 1 : 0
}

function refreshForest(sim: Simulation): void {
  const f = sim.soot
  const world = sim.world
  const tree = sim.featureCode('tree')
  f.forest.fill(0)
  for (let i = 0; i < world.size; i++) {
    if (world.feature[i] === tree) f.forest[f.cellAt(world.xOf(i), world.yOf(i))] += 1
  }
  const area = f.cell * f.cell
  for (let i = 0; i < f.forest.length; i++) f.forest[i] = Math.min(1, f.forest[i] / area)
}

/** Every chimney, stove and fire adds its soot; precipitators clean around them; then the wind does its work. */
export function updateSoot(sim: Simulation): void {
  const r = sim.rules.soot
  const f = sim.soot
  const rate = sim.mods.sootRate ?? 1
  const wind = windVector(sim)
  for (const b of sim.buildings.values()) {
    if (b.site) continue
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    if (b.fire > 0) {
      f.add(cx, cy, r.fireSootPerSecond * rate)
      continue
    }
    const emitter = sim.component<EmitterConfig>(b, 'emitter')
    if (emitter) {
      const load = emitterLoad(sim, b)
      const stack = emitter.stack ?? 0
      if (load > 0) f.add(cx + wind.x * stack, cy + wind.y * stack, emitter.soot * load * rate)
    }
    const burn = b.data.burn as number | undefined
    if (burn) f.add(cx, cy, burn * r.stoveSootPerFirewood * rate)
  }
  for (const b of sim.buildings.values()) {
    const cfg = sim.component<ScrubberConfig>(b, 'scrubber')
    if (!cfg || b.site || b.fire > 0) continue
    const power = sim.def(b).components.consumer ? ((b.data.power as number | undefined) ?? 0) : 1
    if (power <= 0) continue
    const keep = 1 - Math.min(1, cfg.rate * power)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    for (let y = 0; y < f.rows; y++) {
      for (let x = 0; x < f.cols; x++) {
        const dx = (x + 0.5) * f.cell - cx
        const dy = (y + 0.5) * f.cell - cy
        if (dx * dx + dy * dy <= cfg.radius * cfg.radius) f.soot[y * f.cols + x] *= keep
      }
    }
  }
  refreshForest(sim)
  const winter = sim.season.growing ? 1 : r.winterDecayFactor
  f.step(sim.weather.windX, sim.weather.windY, r.diffusion, r.decayPerSecond * winter, r.forestDecayPerSecond * winter, r.depositPerSecond)
}

/** Weather slowly washes grime from the ground. */
export function fadeGrime(sim: Simulation): void {
  const keep = 1 - sim.rules.soot.grimeFadePerMonth
  const g = sim.soot.grime
  for (let i = 0; i < g.length; i++) g[i] *= keep
}
