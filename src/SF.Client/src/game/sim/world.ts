import { decodeArray, encodeArray } from './codec'
import { Terrain } from './types'

export const MARK_CLEAR = 1

/** Grid state for the whole map. Tile (x, y) has index y * width + x; tile centres sit at (x + 0.5, y + 0.5). */
export class World {
  readonly width: number
  readonly height: number
  readonly size: number
  /** Ground height at each tile centre, in world units (1 unit = 1 tile). */
  elevation: Float32Array
  terrain: Uint8Array
  /** 0 = none, otherwise feature content index + 1. */
  feature: Uint8Array
  /** Tree growth (0..255, 255 = mature) or ripeness (0/1) for harvestable features. */
  growth: Uint8Array
  /** Occupying building id, 0 when free. */
  building: Int32Array
  /** 1 where a building blocks movement. */
  solid: Uint8Array
  /** 0 = none, otherwise road content index + 1. */
  road: Uint8Array
  /** Bitmask of energy networks (bit n = rules.networks[n]) with a conduit on the tile. */
  conduit: Uint8Array
  mark: Uint8Array
  /** 1 where a building's entrance must stay clear. */
  door: Uint8Array
  waterLevel: number
  /** Bumped whenever walkability changes. */
  version = 0
  roadSpeeds: number[] = []

  constructor(width: number, height: number, waterLevel: number) {
    this.width = width
    this.height = height
    this.size = width * height
    this.waterLevel = waterLevel
    this.elevation = new Float32Array(this.size)
    this.terrain = new Uint8Array(this.size)
    this.feature = new Uint8Array(this.size)
    this.growth = new Uint8Array(this.size)
    this.building = new Int32Array(this.size)
    this.solid = new Uint8Array(this.size)
    this.road = new Uint8Array(this.size)
    this.conduit = new Uint8Array(this.size)
    this.mark = new Uint8Array(this.size)
    this.door = new Uint8Array(this.size)
  }

  index(x: number, y: number): number {
    return y * this.width + x
  }

  xOf(i: number): number {
    return i % this.width
  }

  yOf(i: number): number {
    return (i / this.width) | 0
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Water and mountains can never be walked or built on. */
  isLand(i: number): boolean {
    const t = this.terrain[i]
    return t !== Terrain.Water && t !== Terrain.Mountain
  }

  walkable(i: number): boolean {
    return this.isLand(i) && this.solid[i] === 0
  }

  /** Movement speed multiplier on this tile. */
  speed(i: number): number {
    const r = this.road[i]
    return r === 0 ? 1 : this.roadSpeeds[r - 1]
  }

  maxSpeed(): number {
    return Math.max(1, ...this.roadSpeeds)
  }

  /** Smooth ground height at a continuous tile-space position (bilinear over tile centres). */
  heightAt(x: number, y: number): number {
    const fx = Math.min(this.width - 1.001, Math.max(0, x - 0.5))
    const fy = Math.min(this.height - 1.001, Math.max(0, y - 0.5))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i = y0 * this.width + x0
    const a = this.elevation[i]
    const b = this.elevation[i + 1]
    const c = this.elevation[i + this.width]
    const d = this.elevation[i + this.width + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
  }

  distance(a: number, b: number): number {
    const dx = this.xOf(a) - this.xOf(b)
    const dy = this.yOf(a) - this.yOf(b)
    return Math.sqrt(dx * dx + dy * dy)
  }

  /** Calls fn for every in-bounds tile index within radius of (cx, cy), nearest rings first is NOT guaranteed. */
  forRadius(cx: number, cy: number, radius: number, fn: (i: number, d2: number) => void): void {
    const r = Math.ceil(radius)
    const r2 = radius * radius
    const x0 = Math.max(0, Math.floor(cx) - r)
    const x1 = Math.min(this.width - 1, Math.floor(cx) + r)
    const y0 = Math.max(0, Math.floor(cy) - r)
    const y1 = Math.min(this.height - 1, Math.floor(cy) + r)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const d2 = dx * dx + dy * dy
        if (d2 <= r2) fn(y * this.width + x, d2)
      }
    }
  }

  serialize(): WorldSnapshot {
    return {
      width: this.width,
      height: this.height,
      waterLevel: this.waterLevel,
      elevation: encodeArray(this.elevation),
      terrain: encodeArray(this.terrain),
      feature: encodeArray(this.feature),
      growth: encodeArray(this.growth),
      road: encodeArray(this.road),
      conduit: encodeArray(this.conduit),
      mark: encodeArray(this.mark),
    }
  }

  /** Building occupancy, solidity and doors are rebuilt from the building list by the simulation. */
  static deserialize(s: WorldSnapshot): World {
    const world = new World(s.width, s.height, s.waterLevel)
    world.elevation = decodeArray(s.elevation, Float32Array)
    world.terrain = decodeArray(s.terrain, Uint8Array)
    world.feature = decodeArray(s.feature, Uint8Array)
    world.growth = decodeArray(s.growth, Uint8Array)
    world.road = decodeArray(s.road, Uint8Array)
    world.conduit = decodeArray(s.conduit, Uint8Array)
    world.mark = decodeArray(s.mark, Uint8Array)
    return world
  }
}

export interface WorldSnapshot {
  width: number
  height: number
  waterLevel: number
  elevation: string
  terrain: string
  feature: string
  growth: string
  road: string
  conduit: string
  mark: string
}
