import * as THREE from 'three'
import { fbm, hash2 } from '../sim/noise'
import { Terrain } from '../sim/types'
import type { World } from '../sim/world'

const CHUNK = 32
/** Texels per tile in the ground colour map (crisp roads, soft terrain borders). */
const TEXELS = 4

const TERRAIN_COLORS: Record<number, [number, number, number]> = {
  [Terrain.Grass]: [0.36, 0.48, 0.22],
  [Terrain.Water]: [0.22, 0.27, 0.2],
  [Terrain.Mountain]: [0.42, 0.4, 0.37],
  [Terrain.Stone]: [0.56, 0.54, 0.5],
  [Terrain.Iron]: [0.52, 0.34, 0.24],
  [Terrain.Coal]: [0.2, 0.19, 0.18],
  [Terrain.Sand]: [0.74, 0.67, 0.5],
  [Terrain.Copper]: [0.24, 0.46, 0.38],
}

const ROAD_COLORS: [number, number, number][] = [
  [0.5, 0.39, 0.27],
  [0.48, 0.46, 0.43],
]

/**
 * Terrain: chunked heightfield meshes over tile corners, coloured by a per-tile data texture (terrain, roads,
 * clear marks) sampled in world space. A shader patch adds slope rock, seasonal tint and snow cover.
 */
export class TerrainLayer {
  readonly group = new THREE.Group()
  readonly material: THREE.MeshStandardMaterial
  readonly water: THREE.Mesh
  private readonly world: World
  private readonly heights: Float32Array
  private readonly colorData: Uint8Array
  private readonly colorTex: THREE.DataTexture
  private readonly chunks = new Map<number, THREE.Mesh>()
  private readonly uniforms = {
    uSnow: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTime: { value: 0 },
  }
  private dirtyColors = false

  constructor(world: World) {
    this.world = world
    const vw = world.width + 1
    this.heights = new Float32Array(vw * (world.height + 1))
    this.colorData = new Uint8Array(world.width * TEXELS * world.height * TEXELS * 4)
    this.colorTex = new THREE.DataTexture(this.colorData, world.width * TEXELS, world.height * TEXELS, THREE.RGBAFormat)
    this.colorTex.colorSpace = THREE.SRGBColorSpace
    this.colorTex.magFilter = THREE.LinearFilter
    this.colorTex.minFilter = THREE.LinearMipmapLinearFilter
    this.colorTex.generateMipmaps = true
    this.colorTex.anisotropy = 4

    this.material = new THREE.MeshStandardMaterial({ map: this.colorTex, roughness: 0.95, metalness: 0 })
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldN;\nvarying float vHeight;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWorldN = normalize(normal);\nvHeight = position.y;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldN;\nvarying float vHeight;\nuniform float uSnow;\nuniform vec3 uTint;',
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float slope = 1.0 - clamp(vWorldN.y, 0.0, 1.0);
          vec3 rock = vec3(0.36, 0.34, 0.31) * (0.85 + 0.3 * fract(sin(dot(floor(vMapUv * 512.0), vec2(12.9898, 78.233))) * 43758.5453));
          diffuseColor.rgb = mix(diffuseColor.rgb * uTint, rock, smoothstep(0.35, 0.6, slope));
          float snow = uSnow * smoothstep(0.55, 0.25, slope);
          snow = max(snow, smoothstep(9.0, 12.0, vHeight) * smoothstep(0.75, 0.3, slope));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), clamp(snow, 0.0, 0.95));`,
        )
    }

    this.computeHeights()
    this.paintAll()
    for (let cy = 0; cy < Math.ceil(world.height / CHUNK); cy++) {
      for (let cx = 0; cx < Math.ceil(world.width / CHUNK); cx++) this.buildChunk(cx, cy)
    }

    const waterGeo = new THREE.PlaneGeometry(world.width + 200, world.height + 200, 1, 1)
    waterGeo.rotateX(-Math.PI / 2)
    const waterMat = new THREE.MeshStandardMaterial({ color: '#2c5866', roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.86 })
    waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          normal = normalize(normal + vec3(sin(gl_FragCoord.x * 0.05 + uTime * 1.3) * 0.04, 0.0, cos(gl_FragCoord.y * 0.06 + uTime * 1.1) * 0.04));`,
        )
    }
    this.water = new THREE.Mesh(waterGeo, waterMat)
    this.water.position.set(world.width / 2, world.waterLevel, world.height / 2)
    this.water.receiveShadow = true
    this.group.add(this.water)
  }

  /** Vertex heights at tile corners: the mean of the surrounding tile centres. */
  private computeHeights(x0 = 0, y0 = 0, x1 = this.world.width, y1 = this.world.height): void {
    const w = this.world
    const vw = w.width + 1
    for (let vy = y0; vy <= y1; vy++) {
      for (let vx = x0; vx <= x1; vx++) {
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const tx = vx + dx
            const ty = vy + dy
            if (tx >= 0 && ty >= 0 && tx < w.width && ty < w.height) {
              sum += w.elevation[ty * w.width + tx]
              n++
            }
          }
        }
        this.heights[vy * vw + vx] = n ? sum / n : 0
      }
    }
  }

  heightAtCorner(vx: number, vy: number): number {
    return this.heights[vy * (this.world.width + 1) + vx]
  }

  private buildChunk(cx: number, cy: number): void {
    const w = this.world
    const vw = w.width + 1
    const x0 = cx * CHUNK
    const y0 = cy * CHUNK
    const x1 = Math.min(w.width, x0 + CHUNK)
    const y1 = Math.min(w.height, y0 + CHUNK)
    const cols = x1 - x0 + 1
    const rows = y1 - y0 + 1
    const positions = new Float32Array(cols * rows * 3)
    const normals = new Float32Array(cols * rows * 3)
    const uvs = new Float32Array(cols * rows * 2)
    const h = (vx: number, vy: number) => this.heights[Math.max(0, Math.min(w.height, vy)) * vw + Math.max(0, Math.min(w.width, vx))]
    let k = 0
    for (let vy = y0; vy <= y1; vy++) {
      for (let vx = x0; vx <= x1; vx++) {
        positions[k * 3] = vx
        positions[k * 3 + 1] = h(vx, vy)
        positions[k * 3 + 2] = vy
        // Central-difference normals from the global height grid: no seams between chunks.
        const nx = h(vx - 1, vy) - h(vx + 1, vy)
        const nz = h(vx, vy - 1) - h(vx, vy + 1)
        const len = Math.sqrt(nx * nx + 4 + nz * nz)
        normals[k * 3] = nx / len
        normals[k * 3 + 1] = 2 / len
        normals[k * 3 + 2] = nz / len
        uvs[k * 2] = vx / w.width
        uvs[k * 2 + 1] = vy / w.height
        k++
      }
    }
    const index: number[] = []
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(index)
    geo.computeBoundingSphere()

    const key = cy * 1000 + cx
    const old = this.chunks.get(key)
    if (old) {
      old.geometry.dispose()
      old.geometry = geo
      return
    }
    const mesh = new THREE.Mesh(geo, this.material)
    mesh.receiveShadow = true
    mesh.castShadow = true
    this.chunks.set(key, mesh)
    this.group.add(mesh)
  }

  private paintTile(x: number, y: number): void {
    const w = this.world
    const i = y * w.width + x
    const road = w.road[i]
    const tileColor = (tx: number, ty: number) => {
      const cx = Math.max(0, Math.min(w.width - 1, tx))
      const cy = Math.max(0, Math.min(w.height - 1, ty))
      return TERRAIN_COLORS[w.terrain[cy * w.width + cx]] ?? TERRAIN_COLORS[0]
    }
    const tw = w.width * TEXELS
    for (let ty = 0; ty < TEXELS; ty++) {
      for (let tx = 0; tx < TEXELS; tx++) {
        const px = x * TEXELS + tx
        const py = y * TEXELS + ty
        const n = fbm(px / 14, py / 14, 7, 3) * 0.35 + hash2(px, py, 3) * 0.12 + 0.72
        // Bilinear blend between neighbouring tile colours: soft borders between grass, sand and seams.
        const fx = (tx + 0.5) / TEXELS - 0.5
        const fy = (ty + 0.5) / TEXELS - 0.5
        const ox = fx < 0 ? -1 : 0
        const oy = fy < 0 ? -1 : 0
        const ax = fx - ox
        const ay = fy - oy
        const c00 = tileColor(x + ox, y + oy)
        const c10 = tileColor(x + ox + 1, y + oy)
        const c01 = tileColor(x + ox, y + oy + 1)
        const c11 = tileColor(x + ox + 1, y + oy + 1)
        let c: [number, number, number] = [0, 1, 2].map(
          (k) => c00[k] * (1 - ax) * (1 - ay) + c10[k] * ax * (1 - ay) + c01[k] * (1 - ax) * ay + c11[k] * ax * ay,
        ) as [number, number, number]
        if (road) {
          // Roads fill the tile but leave a soft verge where the neighbour has no road.
          const edge = Math.min(tx, ty, TEXELS - 1 - tx, TEXELS - 1 - ty) === 0
          const nx = tx === 0 ? -1 : tx === TEXELS - 1 ? 1 : 0
          const ny = ty === 0 ? -1 : ty === TEXELS - 1 ? 1 : 0
          const neighbour = (nx || ny) && w.inBounds(x + nx, y + ny) ? w.road[(y + ny) * w.width + x + nx] : 0
          if (!edge || neighbour || (nx && ny && (w.road[y * w.width + x + nx] || w.road[(y + ny) * w.width + x]))) c = ROAD_COLORS[road - 1] ?? ROAD_COLORS[0]
        }
        const o = (py * tw + px) * 4
        this.colorData[o] = Math.min(255, c[0] * n * 255)
        this.colorData[o + 1] = Math.min(255, c[1] * n * 255)
        this.colorData[o + 2] = Math.min(255, c[2] * n * 255)
        this.colorData[o + 3] = 255
      }
    }
  }

  private paintAll(): void {
    for (let y = 0; y < this.world.height; y++) for (let x = 0; x < this.world.width; x++) this.paintTile(x, y)
    this.colorTex.needsUpdate = true
  }

  /** Repaints a tile and its neighbours (roads blend into each other). */
  repaint(tile: number): void {
    const w = this.world
    const x = w.xOf(tile)
    const y = w.yOf(tile)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (w.inBounds(x + dx, y + dy)) this.paintTile(x + dx, y + dy)
    }
    this.dirtyColors = true
  }

  /** Heights changed under a new building (flattened ground). */
  reshape(x: number, y: number, w: number, h: number): void {
    this.computeHeights(Math.max(0, x - 1), Math.max(0, y - 1), Math.min(this.world.width, x + w + 1), Math.min(this.world.height, y + h + 1))
    const cx0 = Math.floor(Math.max(0, x - 2) / CHUNK)
    const cy0 = Math.floor(Math.max(0, y - 2) / CHUNK)
    const cx1 = Math.floor(Math.min(this.world.width - 1, x + w + 2) / CHUNK)
    const cy1 = Math.floor(Math.min(this.world.height - 1, y + h + 2) / CHUNK)
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.buildChunk(cx, cy)
  }

  /** Ground height at a continuous tile-space position, matching the rendered mesh. */
  heightAt(x: number, y: number): number {
    const w = this.world
    const fx = Math.max(0, Math.min(w.width - 0.001, x))
    const fy = Math.max(0, Math.min(w.height - 0.001, y))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const a = this.heightAtCorner(x0, y0)
    const b = this.heightAtCorner(x0 + 1, y0)
    const c = this.heightAtCorner(x0, y0 + 1)
    const d = this.heightAtCorner(x0 + 1, y0 + 1)
    // Same diagonal split as the mesh triangles.
    if (tx + ty <= 1) return a + (b - a) * tx + (c - a) * ty
    return d + (c - d) * (1 - tx) + (b - d) * (1 - ty)
  }

  setSeason(snow: number, tint: THREE.Color): void {
    this.uniforms.uSnow.value = snow
    this.uniforms.uTint.value.copy(tint)
  }

  update(time: number): void {
    this.uniforms.uTime.value = time
    if (this.dirtyColors) {
      this.colorTex.needsUpdate = true
      this.dirtyColors = false
    }
  }

  dispose(): void {
    for (const m of this.chunks.values()) m.geometry.dispose()
    this.material.dispose()
    this.colorTex.dispose()
    this.water.geometry.dispose()
    ;(this.water.material as THREE.Material).dispose()
  }
}
