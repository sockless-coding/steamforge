import type { World } from './world'

const SQRT2 = Math.SQRT2

/**
 * A* over the 8-connected tile grid. Roads lower the cost of entering a tile; diagonal moves may not cut corners
 * past blocked tiles. Scratch buffers are reused across searches (generation stamps avoid clearing them).
 */
export class Pathfinder {
  private readonly world: World
  private g: Float32Array
  private parent: Int32Array
  private seen: Uint32Array
  private closed: Uint32Array
  private gen = 0
  private heapIdx: Int32Array
  private heapF: Float32Array
  private heapSize = 0
  /** Searches performed this tick; the simulation caps it to bound frame cost. */
  searches = 0

  constructor(world: World) {
    this.world = world
    const n = world.size
    this.g = new Float32Array(n)
    this.parent = new Int32Array(n)
    this.seen = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heapIdx = new Int32Array(n * 2)
    this.heapF = new Float32Array(n * 2)
  }

  /**
   * Returns the tiles to walk (excluding the start, including the goal), [] when already there, or null when the
   * goal cannot be reached. The start tile may be blocked (a citizen caught inside a new footprint walks out).
   */
  find(start: number, goal: number, maxExpand = 60000): number[] | null {
    this.searches++
    const world = this.world
    if (start === goal) return []
    if (!world.walkable(goal)) return null
    const w = world.width
    const gx = goal % w
    const gy = (goal / w) | 0
    const minCost = 1 / world.maxSpeed()

    this.gen++
    if (this.gen === 0xffffffff) {
      this.seen.fill(0)
      this.closed.fill(0)
      this.gen = 1
    }
    const gen = this.gen
    this.heapSize = 0
    this.g[start] = 0
    this.parent[start] = -1
    this.seen[start] = gen
    this.push(start, this.heuristic(start, gx, gy, w) * minCost)

    let expanded = 0
    while (this.heapSize > 0) {
      const current = this.pop()
      if (this.closed[current] === gen) continue
      this.closed[current] = gen
      if (current === goal) return this.unwind(goal)
      if (++expanded > maxExpand) return null

      const cx = current % w
      const cy = (current / w) | 0
      const gc = this.g[current]
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy
        if (ny < 0 || ny >= world.height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = cx + dx
          if (nx < 0 || nx >= w) continue
          const next = ny * w + nx
          if (this.closed[next] === gen || !world.walkable(next)) continue
          let step = 1
          if (dx !== 0 && dy !== 0) {
            if (!world.walkable(cy * w + nx) || !world.walkable(ny * w + cx)) continue
            step = SQRT2
          }
          const cost = gc + step / world.speed(next)
          if (this.seen[next] !== gen || cost < this.g[next]) {
            this.seen[next] = gen
            this.g[next] = cost
            this.parent[next] = current
            this.push(next, cost + this.heuristic(next, gx, gy, w) * minCost)
          }
        }
      }
    }
    return null
  }

  private heuristic(i: number, gx: number, gy: number, w: number): number {
    const dx = Math.abs((i % w) - gx)
    const dy = Math.abs(((i / w) | 0) - gy)
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)
  }

  private unwind(goal: number): number[] {
    const path: number[] = []
    let i = goal
    while (this.parent[i] !== -1) {
      path.push(i)
      i = this.parent[i]
    }
    return path.reverse()
  }

  private push(i: number, f: number): void {
    if (this.heapSize >= this.heapIdx.length) {
      const idx = new Int32Array(this.heapIdx.length * 2)
      idx.set(this.heapIdx)
      const fs = new Float32Array(this.heapF.length * 2)
      fs.set(this.heapF)
      this.heapIdx = idx
      this.heapF = fs
    }
    let k = this.heapSize++
    while (k > 0) {
      const parent = (k - 1) >> 1
      if (this.heapF[parent] <= f) break
      this.heapIdx[k] = this.heapIdx[parent]
      this.heapF[k] = this.heapF[parent]
      k = parent
    }
    this.heapIdx[k] = i
    this.heapF[k] = f
  }

  private pop(): number {
    const top = this.heapIdx[0]
    const lastI = this.heapIdx[--this.heapSize]
    const lastF = this.heapF[this.heapSize]
    let k = 0
    const half = this.heapSize >> 1
    while (k < half) {
      let child = 2 * k + 1
      if (child + 1 < this.heapSize && this.heapF[child + 1] < this.heapF[child]) child++
      if (this.heapF[child] >= lastF) break
      this.heapIdx[k] = this.heapIdx[child]
      this.heapF[k] = this.heapF[child]
      k = child
    }
    this.heapIdx[k] = lastI
    this.heapF[k] = lastF
    return top
  }
}
