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
  glassroof: { color: '#7aa0b0', roughness: 0.15, metalness: 0.3, transparent: 0.75 },
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
}

const materials = new Map<string, THREE.MeshStandardMaterial>()

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
    })
    materials.set(name, m)
  }
  return m
}

/** Furnace glow for idle buildings (swapped in when nobody is working). */
export function idleGlow(): THREE.MeshStandardMaterial {
  let m = materials.get('$glow-idle')
  if (!m) {
    m = material('glow').clone()
    m.emissiveIntensity = 0.15
    materials.set('$glow-idle', m)
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
