import * as THREE from 'three'
import { fbm, hash2 } from '../sim/noise'

// Procedural PBR material library. Every surface is generated from noise on a canvas at startup: no image assets.

type Painter = (ctx: CanvasRenderingContext2D, size: number) => void

function canvasTexture(size: number, paint: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  paint(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function shadeRgb(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

function speckle(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number) {
  const img = ctx.getImageData(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const n = (fbm(x / 9, y / 9, seed, 3) - 0.5) * amount + (hash2(x, y, seed) - 0.5) * amount * 0.5
      img.data[i] = Math.max(0, Math.min(255, img.data[i] * (1 + n)))
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * (1 + n)))
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * (1 + n)))
    }
  }
  ctx.putImageData(img, 0, 0)
}

const painters: Record<string, Painter> = {
  brick: (ctx, s) => {
    ctx.fillStyle = '#5a4a40'
    ctx.fillRect(0, 0, s, s)
    const rows = 8
    const h = s / rows
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 8 : 0
      for (let c = -1; c < 4; c++) {
        const k = 0.85 + hash2(r, c, 7) * 0.3
        ctx.fillStyle = shadeRgb('#9a4a32', k)
        ctx.fillRect(c * (s / 4) + off + 2, r * h + 2, s / 4 - 4, h - 4)
      }
    }
    speckle(ctx, s, 0.25, 3)
  },
  stone: (ctx, s) => {
    ctx.fillStyle = '#5e5a54'
    ctx.fillRect(0, 0, s, s)
    const rows = 4
    for (let r = 0; r < rows; r++) {
      let x = -hash2(r, 0, 11) * 30
      while (x < s) {
        const w = 26 + hash2(r, x | 0, 12) * 30
        ctx.fillStyle = shadeRgb('#9a958c', 0.8 + hash2(r, x | 0, 13) * 0.35)
        ctx.fillRect(x + 2, r * (s / rows) + 2, w - 4, s / rows - 4)
        x += w
      }
    }
    speckle(ctx, s, 0.3, 5)
  },
  timber: (ctx, s) => {
    const rows = 6
    for (let r = 0; r < rows; r++) {
      const g = ctx.createLinearGradient(0, r * (s / rows), 0, (r + 1) * (s / rows))
      const k = 0.85 + hash2(r, 1, 21) * 0.3
      g.addColorStop(0, shadeRgb('#6a4428', k * 0.7))
      g.addColorStop(0.3, shadeRgb('#8a5a34', k))
      g.addColorStop(0.75, shadeRgb('#7a4e2c', k))
      g.addColorStop(1, shadeRgb('#4a2e18', k * 0.7))
      ctx.fillStyle = g
      ctx.fillRect(0, r * (s / rows), s, s / rows)
    }
    speckle(ctx, s, 0.2, 9)
  },
  plank: (ctx, s) => {
    const cols = 6
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = shadeRgb('#8a6a48', 0.8 + hash2(c, 3, 31) * 0.35)
      ctx.fillRect(c * (s / cols), 0, s / cols - 2, s)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(c * (s / cols) + s / cols - 2, 0, 2, s)
    }
    speckle(ctx, s, 0.25, 33)
  },
  slate: (ctx, s) => {
    ctx.fillStyle = '#2a2e34'
    ctx.fillRect(0, 0, s, s)
    const rows = 8
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / 12 : 0
      for (let c = -1; c < 6; c++) {
        ctx.fillStyle = shadeRgb('#4a5058', 0.8 + hash2(r, c, 41) * 0.35)
        ctx.fillRect(c * (s / 6) + off + 1, r * (s / rows) + 1, s / 6 - 2, s / rows - 2)
      }
    }
    speckle(ctx, s, 0.2, 43)
  },
  thatch: (ctx, s) => {
    ctx.fillStyle = '#9a7a40'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 900; i++) {
      const x = hash2(i, 1, 51) * s
      const y = hash2(i, 2, 52) * s
      ctx.strokeStyle = shadeRgb('#c8a060', 0.6 + hash2(i, 3, 53) * 0.6)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (hash2(i, 4, 54) - 0.5) * 4, y + 10 + hash2(i, 5, 55) * 10)
      ctx.stroke()
    }
  },
  metal: (ctx, s) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, s, s)
    speckle(ctx, s, 0.12, 61)
  },
  /** Riveted plates: tinted by the material colour (iron, copper, brass). */
  rivets: (ctx, s) => {
    ctx.fillStyle = '#e4e4e4'
    ctx.fillRect(0, 0, s, s)
    const panels = 2
    const p = s / panels
    for (let py = 0; py < panels; py++) {
      for (let px = 0; px < panels; px++) {
        const g = ctx.createLinearGradient(px * p, py * p, px * p + p, py * p + p)
        const k = 0.88 + hash2(px, py, 71) * 0.18
        g.addColorStop(0, shadeRgb('#f4f4f4', k))
        g.addColorStop(1, shadeRgb('#c8c8c8', k))
        ctx.fillStyle = g
        ctx.fillRect(px * p + 1, py * p + 1, p - 2, p - 2)
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    for (let k = 0; k <= panels; k++) {
      ctx.fillRect(k * p - 1, 0, 2, s)
      ctx.fillRect(0, k * p - 1, s, 2)
    }
    for (let k = 0; k <= panels; k++) {
      for (let t = 0; t < s; t += s / 10) {
        for (const [x, y] of [
          [k * p, t + s / 20],
          [t + s / 20, k * p],
        ]) {
          ctx.fillStyle = 'rgba(0,0,0,0.4)'
          ctx.beginPath()
          ctx.arc(x + 1, y + 1, 2.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(x, y, 1.8, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    speckle(ctx, s, 0.14, 73)
  },
  /** Weathered copper: blue-green patina over bare copper, streaked by rain. */
  verdigris: (ctx, s) => {
    const img = ctx.createImageData(s, s)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = fbm(x / 16, y / 24, 81, 4)
        const streak = fbm(x / 3, y / 40, 83, 2)
        const patina = Math.min(1, Math.max(0, (n - 0.35) * 2.6 + (streak - 0.5) * 0.6))
        const i = (y * s + x) * 4
        img.data[i] = 168 * (1 - patina) + 92 * patina
        img.data[i + 1] = 104 * (1 - patina) + 160 * patina
        img.data[i + 2] = 60 * (1 - patina) + 138 * patina
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    speckle(ctx, s, 0.18, 85)
  },
  /** Terracotta roof tiles in overlapping rows. */
  tile: (ctx, s) => {
    ctx.fillStyle = '#4a2418'
    ctx.fillRect(0, 0, s, s)
    const rows = 8
    const cols = 8
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? s / cols / 2 : 0
      for (let c = -1; c < cols; c++) {
        const x = c * (s / cols) + off
        const y = r * (s / rows)
        const g = ctx.createLinearGradient(x, 0, x + s / cols, 0)
        const k = 0.8 + hash2(r, c, 91) * 0.35
        g.addColorStop(0, shadeRgb('#8a3a24', k * 0.8))
        g.addColorStop(0.5, shadeRgb('#b4553a', k))
        g.addColorStop(1, shadeRgb('#7a3020', k * 0.75))
        ctx.fillStyle = g
        ctx.fillRect(x + 1, y + 1, s / cols - 2, s / rows - 1)
      }
    }
    speckle(ctx, s, 0.2, 93)
  },
  /** Doped airship canvas: tan gores with darker stitched seams. */
  envelope: (ctx, s) => {
    ctx.fillStyle = '#d2bf94'
    ctx.fillRect(0, 0, s, s)
    const gores = 8
    for (let k = 0; k < gores; k++) {
      ctx.fillStyle = shadeRgb('#d2bf94', 0.9 + hash2(k, 5, 111) * 0.14)
      ctx.fillRect((k * s) / gores + 1, 0, s / gores - 2, s)
      ctx.fillStyle = 'rgba(70,50,30,0.35)'
      ctx.fillRect((k * s) / gores, 0, 1.5, s)
    }
    speckle(ctx, s, 0.12, 113)
  },
  /** Cream render with soot stains low on the wall. */
  plaster: (ctx, s) => {
    ctx.fillStyle = '#d8ccb0'
    ctx.fillRect(0, 0, s, s)
    speckle(ctx, s, 0.16, 101)
  },
}

const textures = new Map<string, THREE.Texture>()
function texture(name: string): THREE.Texture {
  let t = textures.get(name)
  if (!t) {
    t = canvasTexture(128, painters[name])
    textures.set(name, t)
  }
  return t
}

interface MatSpec {
  color: string
  roughness: number
  metalness?: number
  map?: string
  emissive?: string
  emissiveIntensity?: number
  transparent?: number
}

const specs: Record<string, MatSpec> = {
  timber: { color: '#ffffff', roughness: 0.9, map: 'timber' },
  plank: { color: '#ffffff', roughness: 0.9, map: 'plank' },
  stone: { color: '#ffffff', roughness: 0.95, map: 'stone' },
  brick: { color: '#ffffff', roughness: 0.9, map: 'brick' },
  slate: { color: '#ffffff', roughness: 0.7, map: 'slate' },
  thatch: { color: '#ffffff', roughness: 1, map: 'thatch' },
  brass: { color: '#d4a24a', roughness: 0.32, metalness: 0.9, map: 'metal' },
  copper: { color: '#c06a3e', roughness: 0.38, metalness: 0.85, map: 'metal' },
  iron: { color: '#4e4a46', roughness: 0.6, metalness: 0.75, map: 'metal' },
  glass: { color: '#3a4a52', roughness: 0.15, metalness: 0.2, emissive: '#ffb860', emissiveIntensity: 0.35 },
  glassroof: { color: '#a8c8d4', roughness: 0.1, metalness: 0.2, transparent: 0.42 },
  glow: { color: '#3a1a08', roughness: 0.6, emissive: '#ff7a2a', emissiveIntensity: 2.2 },
  soil: { color: '#5a4632', roughness: 1 },
  leaf: { color: '#3f6a32', roughness: 0.85 },
  berry: { color: '#8a2040', roughness: 0.5 },
  leather: { color: '#8a5a32', roughness: 0.8 },
  canvas: { color: '#c8b890', roughness: 0.95 },
  soot: { color: '#2a2624', roughness: 1 },
  ore: { color: '#7a4a36', roughness: 0.8, metalness: 0.3 },
  coal: { color: '#1c1a1a', roughness: 0.55, metalness: 0.1 },
  water: { color: '#2e5a6a', roughness: 0.1, metalness: 0.2 },
  // Steampunk palette: riveted plate, weathered copper, soot-black iron, painted iron, clay tile, render.
  plate: { color: '#6a645c', roughness: 0.5, metalness: 0.75, map: 'rivets' },
  copperplate: { color: '#c47048', roughness: 0.5, metalness: 0.75, map: 'rivets' },
  brassplate: { color: '#d0a24c', roughness: 0.42, metalness: 0.85, map: 'rivets' },
  verdigris: { color: '#ffffff', roughness: 0.62, metalness: 0.35, map: 'verdigris' },
  darkiron: { color: '#2e2b28', roughness: 0.55, metalness: 0.7, map: 'metal' },
  redpaint: { color: '#8e2a1e', roughness: 0.55, metalness: 0.3, map: 'rivets' },
  tile: { color: '#ffffff', roughness: 0.85, map: 'tile' },
  plaster: { color: '#ffffff', roughness: 0.95, map: 'plaster' },
  envelope: { color: '#ffffff', roughness: 0.9, map: 'envelope' },
  malachite: { color: '#3f8a72', roughness: 0.7, metalness: 0.2 },
  /** Always-lit gas lamps and lanterns. */
  lamp: { color: '#ffe0a0', roughness: 0.4, emissive: '#ffb44a', emissiveIntensity: 1.6 },
  /** Gauge faces. */
  dial: { color: '#efe6cc', roughness: 0.4, emissive: '#efe0b8', emissiveIntensity: 0.25 },
  /** Galvanic arcs and charged coils (blue-white glow). */
  arc: { color: '#1a2a3a', roughness: 0.4, emissive: '#7fdcff', emissiveIntensity: 1.1 },
}

const materials = new Map<string, THREE.MeshStandardMaterial>()
let environment: THREE.Texture | null = null

/**
 * Reflections for building materials only (brass, copper, glass and stone get something to mirror); terrain and
 * nature keep their flat look. Applies to materials already made and to every one made later.
 */
export function setBuildingEnvironment(texture: THREE.Texture | null): void {
  environment = texture
  for (const m of materials.values()) {
    m.envMap = texture
    m.needsUpdate = true
  }
}

let envIntensity = 0.55

/** Reflection strength for building materials (dimmed at night so metal doesn't glow in the dark). */
export function setBuildingEnvironmentIntensity(k: number): void {
  if (Math.abs(k - envIntensity) < 0.005) return
  envIntensity = k
  for (const m of materials.values()) m.envMapIntensity = k
}

/** Shared material by content material name (buildings.json `mat`). Unknown names fall back to timber. */
export function material(name: string): THREE.MeshStandardMaterial {
  let m = materials.get(name)
  if (!m) {
    const spec = specs[name] ?? specs.timber
    m = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0,
      map: spec.map ? texture(spec.map) : null,
      emissive: spec.emissive ?? '#000000',
      emissiveIntensity: spec.emissiveIntensity ?? 0,
      transparent: spec.transparent !== undefined,
      opacity: spec.transparent ?? 1,
      envMap: environment,
      envMapIntensity: envIntensity,
    })
    materials.set(name, m)
  }
  return m
}

/** A glowing material dimmed for idle buildings (swapped in when nobody is working). */
export function idleGlow(name = 'glow'): THREE.MeshStandardMaterial {
  const key = `$idle-${name}`
  let m = materials.get(key)
  if (!m) {
    m = material(name).clone()
    m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.15)
    materials.set(key, m)
  }
  return m
}

export function ghostMaterial(valid: boolean): THREE.MeshBasicMaterial {
  const key = valid ? '$ghost-ok' : '$ghost-bad'
  let m = materials.get(key) as unknown as THREE.MeshBasicMaterial | undefined
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: valid ? '#7ad46a' : '#e0503a', transparent: true, opacity: 0.45, depthWrite: false })
    materials.set(key, m as unknown as THREE.MeshStandardMaterial)
  }
  return m
}
