import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { FeatureDef } from '../../api/types'
import { hash2 } from '../sim/noise'
import { MARK_CLEAR, type World } from '../sim/world'
import type { TerrainLayer } from './terrain'

type Kind = 'pineTrunk' | 'pineCanopy' | 'oakTrunk' | 'oakCanopy' | 'rock' | 'ironstone' | 'bush' | 'berries' | 'mushroom'

function geo(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!
}

function geometries(): Record<Kind, THREE.BufferGeometry> {
  const pineCanopy = geo([
    new THREE.ConeGeometry(0.62, 1.1, 8).translate(0, 1.0, 0),
    new THREE.ConeGeometry(0.5, 0.95, 8).translate(0, 1.55, 0),
    new THREE.ConeGeometry(0.34, 0.8, 8).translate(0, 2.05, 0),
  ])
  const oakCanopy = geo([
    new THREE.IcosahedronGeometry(0.62, 1).translate(0, 1.45, 0),
    new THREE.IcosahedronGeometry(0.45, 1).translate(0.32, 1.25, 0.15),
    new THREE.IcosahedronGeometry(0.42, 1).translate(-0.28, 1.3, -0.2),
  ])
  const rock = new THREE.DodecahedronGeometry(0.42, 0).scale(1, 0.62, 0.85).translate(0, 0.16, 0)
  const bush = geo([new THREE.IcosahedronGeometry(0.32, 1).scale(1, 0.7, 1).translate(0, 0.2, 0), new THREE.IcosahedronGeometry(0.22, 1).translate(0.22, 0.16, 0.08)])
  const berries = geo([
    new THREE.SphereGeometry(0.06, 6, 4).translate(0.18, 0.33, 0.12),
    new THREE.SphereGeometry(0.06, 6, 4).translate(-0.12, 0.36, 0.18),
    new THREE.SphereGeometry(0.06, 6, 4).translate(0.05, 0.4, -0.2),
    new THREE.SphereGeometry(0.06, 6, 4).translate(0.3, 0.24, -0.06),
  ])
  const mushroom = geo([
    new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6).translate(0, 0.07, 0),
    new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.13, 0),
    new THREE.CylinderGeometry(0.03, 0.04, 0.1, 6).translate(0.16, 0.05, 0.1),
    new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.16, 0.1, 0.1),
  ])
  return {
    pineTrunk: new THREE.CylinderGeometry(0.07, 0.11, 0.7, 6).translate(0, 0.35, 0),
    pineCanopy,
    oakTrunk: new THREE.CylinderGeometry(0.08, 0.13, 1.1, 6).translate(0, 0.55, 0),
    oakCanopy,
    rock,
    ironstone: rock.clone(),
    bush,
    berries,
    mushroom,
  }
}

const COLORS: Record<Kind, string> = {
  pineTrunk: '#5a3a22',
  pineCanopy: '#2f5a2c',
  oakTrunk: '#6a4a2a',
  oakCanopy: '#4f7a34',
  rock: '#8a857c',
  ironstone: '#8a5038',
  bush: '#3e6a2e',
  berries: '#a01e3a',
  mushroom: '#d8c8a8',
}

const SEASON_CANOPY: Record<string, { pine: string; oak: string; oakScale: number }> = {
  spring: { pine: '#335e2e', oak: '#6a9a3a', oakScale: 0.9 },
  summer: { pine: '#2f5a2c', oak: '#4f7a34', oakScale: 1 },
  autumn: { pine: '#2e5228', oak: '#b8702a', oakScale: 0.95 },
  winter: { pine: '#c8d2d0', oak: '#6a5a48', oakScale: 0.45 },
}

const MARKED = new THREE.Color('#ff6a4a')
const WHITE = new THREE.Color('#ffffff')

/** Trees, rocks, bushes and mushrooms as one instanced mesh per model part. Rebuilt in bulk when features change. */
export class NatureLayer {
  readonly group = new THREE.Group()
  private readonly world: World
  private readonly terrain: TerrainLayer
  private readonly models: string[]
  private readonly geos: Record<Kind, THREE.BufferGeometry>
  private readonly mats: Record<Kind, THREE.MeshStandardMaterial>
  private meshes = new Map<Kind, THREE.InstancedMesh>()
  private dirty = true
  private lastBuild = -Infinity
  private oakScale = 1
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly pos = new THREE.Vector3()
  private readonly scale = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)

  constructor(world: World, terrain: TerrainLayer, features: FeatureDef[]) {
    this.world = world
    this.terrain = terrain
    this.models = features.map((f) => f.model)
    this.geos = geometries()
    this.mats = Object.fromEntries(
      (Object.keys(COLORS) as Kind[]).map((k) => [k, new THREE.MeshStandardMaterial({ color: COLORS[k], roughness: k === 'berries' ? 0.4 : 0.9, flatShading: k === 'rock' || k === 'ironstone' })]),
    ) as Record<Kind, THREE.MeshStandardMaterial>
  }

  markDirty(): void {
    this.dirty = true
  }

  setSeason(season: string): void {
    const s = SEASON_CANOPY[season] ?? SEASON_CANOPY.summer
    this.mats.pineCanopy.color.set(s.pine)
    this.mats.oakCanopy.color.set(s.oak)
    if (this.oakScale !== s.oakScale) {
      this.oakScale = s.oakScale
      this.dirty = true
    }
  }

  /** Rebuilds instance buffers at most every 200 ms while dirty. */
  update(now: number): void {
    if (!this.dirty || now - this.lastBuild < 200) return
    this.dirty = false
    this.lastBuild = now
    this.rebuild()
  }

  private place(list: number[][], kind: Kind, x: number, y: number, s: number, rot: number, marked: boolean): void {
    list.push([x, y, s, rot, marked ? 1 : 0, kind === 'oakCanopy' ? this.oakScale : 1])
  }

  private rebuild(): void {
    const w = this.world
    const lists = new Map<Kind, number[][]>()
    const add = (kind: Kind, x: number, y: number, s: number, rot: number, marked: boolean) => {
      let l = lists.get(kind)
      if (!l) lists.set(kind, (l = []))
      this.place(l, kind, x, y, s, rot, marked)
    }
    for (let i = 0; i < w.size; i++) {
      const code = w.feature[i]
      if (code === 0) continue
      const model = this.models[code - 1]
      const tx = w.xOf(i)
      const ty = w.yOf(i)
      const jx = tx + 0.5 + (hash2(tx, ty, 1) - 0.5) * 0.5
      const jy = ty + 0.5 + (hash2(tx, ty, 2) - 0.5) * 0.5
      const rot = hash2(tx, ty, 3) * Math.PI * 2
      const vary = 0.8 + hash2(tx, ty, 4) * 0.45
      const marked = (w.mark[i] & MARK_CLEAR) !== 0
      switch (model) {
        case 'tree': {
          const g = 0.25 + (0.75 * w.growth[i]) / 255
          const pine = hash2(tx, ty, 5) < 0.55
          add(pine ? 'pineTrunk' : 'oakTrunk', jx, jy, g * vary, rot, marked)
          add(pine ? 'pineCanopy' : 'oakCanopy', jx, jy, g * vary, rot, marked)
          break
        }
        case 'rock':
        case 'ironstone':
          add(model, jx, jy, vary, rot, marked)
          break
        case 'bush':
          add('bush', jx, jy, vary, rot, marked)
          if (w.growth[i] > 0) add('berries', jx, jy, vary, rot, marked)
          break
        case 'mushroom':
          add('mushroom', jx, jy, vary, rot, marked)
          if (w.growth[i] > 0) add('mushroom', jx + 0.25, jy - 0.2, vary * 0.8, rot + 1, marked)
          break
      }
    }

    for (const kind of Object.keys(COLORS) as Kind[]) {
      const items = lists.get(kind) ?? []
      let mesh = this.meshes.get(kind)
      if (!mesh || mesh.instanceMatrix.count < items.length) {
        if (mesh) {
          this.group.remove(mesh)
          mesh.dispose()
        }
        mesh = new THREE.InstancedMesh(this.geos[kind], this.mats[kind], Math.ceil(items.length * 1.3) + 64)
        mesh.castShadow = kind !== 'berries' && kind !== 'mushroom'
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        this.meshes.set(kind, mesh)
        this.group.add(mesh)
      }
      for (let n = 0; n < items.length; n++) {
        const [x, y, s, rot, marked, extra] = items[n]
        this.pos.set(x, this.terrain.heightAt(x, y) - 0.02, y)
        this.quat.setFromAxisAngle(this.up, rot)
        this.scale.set(s * extra, s * (kind === 'oakCanopy' ? 0.6 + 0.4 * extra : 1), s * extra)
        this.matrix.compose(this.pos, this.quat, this.scale)
        mesh.setMatrixAt(n, this.matrix)
        mesh.setColorAt(n, marked ? MARKED : WHITE)
      }
      mesh.count = items.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose()
    for (const g of Object.values(this.geos)) g.dispose()
    for (const m of Object.values(this.mats)) m.dispose()
  }
}
