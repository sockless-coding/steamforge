import type { Content } from '../../api/content'
import type { TerrainPresetDef } from '../../api/types'
import { fbm } from './noise'
import { Rng } from './rng'
import { Terrain } from './types'
import { World } from './world'

export interface GeneratedMap {
  world: World
  spawnX: number
  spawnY: number
}

const WATER_PLANE = -0.15
const RIVERBED = -0.8

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Seeded terrain: fbm elevation, mountain rim, carved rivers, lakes, shore sand, ore/stone/coal seams and nature.
 * The same seed, size and preset always produce the same map.
 */
export function generateMap(content: Content, seed: number, size: number, preset: TerrainPresetDef, startingArea: number): GeneratedMap {
  const n = size
  const rng = new Rng(seed ^ 0x5bd1e995)
  const ns = seed & 0xffff
  const world = new World(n, n, WATER_PLANE)
  const e = new Float32Array(n * n)

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const base = fbm(x / 40, y / 40, ns, 5)
      const d = Math.min(x, y, n - 1 - x, n - 1 - y) / (n * 0.5)
      const edge = (1 - smoothstep(0.04, 0.5, d)) * preset.mountainEdge
      const ridge = Math.max(0, fbm(x / 26, y / 26, ns + 101, 4) - 0.56) * 1.6
      e[y * n + x] = base * 0.8 + edge * 0.55 + ridge
    }
  }

  // Rivers: a noisy walk from one edge to the opposite one, carving a channel and lowering its banks.
  for (let r = 0; r < preset.rivers; r++) {
    const horizontal = rng.chance(0.5)
    const a = 0.2 + rng.next() * 0.6
    const b = 0.2 + rng.next() * 0.6
    let px = horizontal ? 0 : a * n
    let py = horizontal ? a * n : 0
    const tx = horizontal ? n - 1 : b * n
    const ty = horizontal ? b * n : n - 1
    for (let step = 0; step < n * 4; step++) {
      const toward = Math.atan2(ty - py, tx - px)
      const wobble = (fbm(px / 18, py / 18, ns + 200 + r * 31, 3) - 0.5) * 2.6
      px += Math.cos(toward + wobble) * 0.7
      py += Math.sin(toward + wobble) * 0.7
      const width = 1.2 + fbm(px / 30, py / 30, ns + 250 + r, 2) * 1.2
      world.forRadius(px, py, width + 3, (i, d2) => {
        const d = Math.sqrt(d2)
        if (d <= width) e[i] = Math.min(e[i], preset.waterLevel - 0.06)
        else e[i] = Math.min(e[i], preset.waterLevel + 0.02 + (d - width) * 0.05)
      })
      if (Math.hypot(tx - px, ty - py) < 1.5) break
    }
  }

  for (let i = 0; i < n * n; i++) {
    world.terrain[i] = e[i] > preset.mountainLevel ? Terrain.Mountain : e[i] < preset.waterLevel ? Terrain.Water : Terrain.Grass
  }

  const spawn = findSpawn(world, startingArea + 3)
  // Guarantee a usable start even on hostile seeds.
  world.forRadius(spawn.x + 0.5, spawn.y + 0.5, startingArea + 2, (i) => {
    if (!world.isLand(i)) {
      world.terrain[i] = Terrain.Grass
      e[i] = (preset.waterLevel + preset.mountainLevel) / 2
    }
  })

  // Heights in world units.
  const span = preset.mountainLevel - preset.waterLevel
  for (let i = 0; i < n * n; i++) {
    const t = world.terrain[i]
    if (t === Terrain.Water) world.elevation[i] = RIVERBED
    else if (t === Terrain.Mountain) world.elevation[i] = preset.heightScale + 1.2 + (e[i] - preset.mountainLevel) * preset.heightScale * 7
    else world.elevation[i] = Math.max(0.05, ((e[i] - preset.waterLevel) / span) * preset.heightScale)
  }
  smoothLand(world, 2)
  // Shelving riverbeds: shallow at the bank, deep in the channel, so shores slope instead of stepping.
  const fromLand = distanceToLand(world, 4)
  for (let i = 0; i < n * n; i++) {
    if (world.terrain[i] === Terrain.Water) world.elevation[i] = -0.22 - 0.16 * fromLand[i]
  }

  // Flatten the founding ground.
  let sum = 0
  let count = 0
  world.forRadius(spawn.x + 0.5, spawn.y + 0.5, startingArea + 1, (i) => {
    sum += world.elevation[i]
    count++
  })
  const flat = sum / Math.max(1, count)
  world.forRadius(spawn.x + 0.5, spawn.y + 0.5, startingArea + 4, (i, d2) => {
    const d = Math.sqrt(d2)
    const k = smoothstep(startingArea + 4, startingArea + 1, d)
    if (world.isLand(i)) world.elevation[i] = world.elevation[i] * (1 - k) + flat * k
  })

  // Shore sand.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      if (world.terrain[i] !== Terrain.Grass) continue
      if (hasNeighbour(world, x, y, Terrain.Water)) world.terrain[i] = Terrain.Sand
    }
  }

  const mountainDistance = distanceTo(world, Terrain.Mountain, 8)
  placeDeposits(world, rng, preset, spawn, startingArea, mountainDistance)
  placeNature(world, content, rng, preset, ns)

  // Clear the founding ground of anything that would get in the way.
  world.forRadius(spawn.x + 0.5, spawn.y + 0.5, startingArea, (i) => {
    world.feature[i] = 0
    world.growth[i] = 0
    if (world.isLand(i)) world.terrain[i] = Terrain.Grass
  })

  return { world, spawnX: spawn.x, spawnY: spawn.y }
}

function hasNeighbour(world: World, x: number, y: number, terrain: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if ((dx || dy) && world.inBounds(nx, ny) && world.terrain[world.index(nx, ny)] === terrain) return true
    }
  }
  return false
}

function smoothLand(world: World, passes: number): void {
  const n = world.width
  for (let p = 0; p < passes; p++) {
    const next = world.elevation.slice()
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x
        if (!world.isLand(i)) continue
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy * n + dx
            if (world.isLand(j)) {
              sum += world.elevation[j]
              count++
            }
          }
        }
        next[i] = sum / count
      }
    }
    world.elevation = next
  }
}

function findSpawn(world: World, radius: number): { x: number; y: number } {
  const n = world.width
  const c = n >> 1
  const clear = (cx: number, cy: number) => {
    if (cx < radius + 4 || cy < radius + 4 || cx >= n - radius - 4 || cy >= n - radius - 4) return false
    let ok = true
    world.forRadius(cx + 0.5, cy + 0.5, radius, (i) => {
      if (!world.isLand(i)) ok = false
    })
    return ok
  }
  for (let r = 0; r < n / 2; r += 2) {
    for (let dy = -r; dy <= r; dy += 2) {
      for (let dx = -r; dx <= r; dx += 2) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (clear(c + dx, c + dy)) return { x: c + dx, y: c + dy }
      }
    }
  }
  return { x: c, y: c }
}

function distanceToLand(world: World, max: number): Uint8Array {
  const dist = new Uint8Array(world.size).fill(max)
  for (let pass = 0; pass < max; pass++) {
    for (let i = 0; i < world.size; i++) {
      if (world.terrain[i] !== Terrain.Water) {
        dist[i] = 0
        continue
      }
      const x = i % world.width
      const y = (i / world.width) | 0
      let best = dist[i]
      if (x > 0) best = Math.min(best, dist[i - 1] + 1)
      if (x < world.width - 1) best = Math.min(best, dist[i + 1] + 1)
      if (y > 0) best = Math.min(best, dist[i - world.width] + 1)
      if (y < world.height - 1) best = Math.min(best, dist[i + world.width] + 1)
      dist[i] = best
    }
  }
  return dist
}

/** Multi-source BFS distance (in tiles, 4-connected) to the nearest tile of a terrain, capped at max. */
function distanceTo(world: World, terrain: number, max: number): Uint8Array {
  const dist = new Uint8Array(world.size).fill(255)
  const queue = new Int32Array(world.size)
  let head = 0
  let tail = 0
  for (let i = 0; i < world.size; i++) {
    if (world.terrain[i] === terrain) {
      dist[i] = 0
      queue[tail++] = i
    }
  }
  const n = world.width
  while (head < tail) {
    const i = queue[head++]
    const d = dist[i]
    if (d >= max) continue
    const x = i % n
    const y = (i / n) | 0
    const visit = (j: number) => {
      if (dist[j] === 255) {
        dist[j] = d + 1
        queue[tail++] = j
      }
    }
    if (x > 0) visit(i - 1)
    if (x < n - 1) visit(i + 1)
    if (y > 0) visit(i - n)
    if (y < world.height - 1) visit(i + n)
  }
  return dist
}

function placeDeposits(
  world: World,
  rng: Rng,
  preset: TerrainPresetDef,
  spawn: { x: number; y: number },
  startingArea: number,
  mountainDistance: Uint8Array,
): void {
  const kinds: [keyof TerrainPresetDef['deposits'], number][] = [
    ['stone', Terrain.Stone],
    ['iron', Terrain.Iron],
    ['coal', Terrain.Coal],
    ['copper', Terrain.Copper],
  ]
  const n = world.width
  for (const [key, terrain] of kinds) {
    const count = preset.deposits[key] ?? 0
    for (let k = 0; k < count; k++) {
      let chosen = -1
      for (let attempt = 0; attempt < 400 && chosen < 0; attempt++) {
        let x: number
        let y: number
        if (k === 0 && key === 'stone') {
          // The first stone seam is always within reach of the founding site.
          const angle = rng.next() * Math.PI * 2
          const d = startingArea + 8 + rng.next() * 16
          x = Math.round(spawn.x + Math.cos(angle) * d)
          y = Math.round(spawn.y + Math.sin(angle) * d)
        } else {
          x = 4 + rng.int(n - 8)
          y = 4 + rng.int(world.height - 8)
        }
        if (!world.inBounds(x, y)) continue
        const i = world.index(x, y)
        if (world.terrain[i] !== Terrain.Grass) continue
        if (Math.hypot(x - spawn.x, y - spawn.y) < startingArea + 5) continue
        if (key !== 'stone' && mountainDistance[i] > 6 && attempt < 300) continue
        chosen = i
      }
      if (chosen < 0) continue
      const cx = world.xOf(chosen) + 0.5
      const cy = world.yOf(chosen) + 0.5
      const radius = 2 + rng.next() * 1.8
      world.forRadius(cx, cy, radius + 1, (i, d2) => {
        const jitter = rng.next() * 0.9
        if (Math.sqrt(d2) <= radius + jitter - 0.45 && world.isLand(i)) world.terrain[i] = terrain
      })
    }
  }
}

function placeNature(world: World, content: Content, rng: Rng, preset: TerrainPresetDef, ns: number): void {
  const index = (id: string) => content.bundle.features.findIndex((f) => f.id === id) + 1
  const tree = index('tree')
  const rock = index('rock')
  const ironstone = index('ironstone')
  const berries = index('berries')
  const mushrooms = index('mushrooms')
  const n = world.width
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const t = world.terrain[i]
      if (t === Terrain.Water || t === Terrain.Mountain) continue
      const forest = fbm(x / 18, y / 18, ns + 300, 4)
      const density = Math.min(0.85, Math.max(0, (forest - (1 - preset.forest)) * 2.4))
      const roll = rng.next()
      if (t === Terrain.Grass && tree && roll < density) {
        world.feature[i] = tree
        world.growth[i] = rng.chance(0.8) ? 255 : 60 + rng.int(190)
      } else if (rock && ((t === Terrain.Stone && roll < 0.14) || rng.chance(preset.rocks))) {
        world.feature[i] = rock
      } else if (ironstone && t === Terrain.Iron && roll < 0.16) {
        world.feature[i] = ironstone
      } else if (berries && t === Terrain.Grass && rng.chance(preset.berries * (2 + density * 12))) {
        world.feature[i] = berries
      } else if (mushrooms && t === Terrain.Grass && density > 0.15 && rng.chance(preset.berries * density * 12)) {
        world.feature[i] = mushrooms
      }
    }
  }
}
