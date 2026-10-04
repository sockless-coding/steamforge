import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Simulation } from '../sim/simulation'
import { material } from './materials'
import type { TerrainLayer } from './terrain'

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

/**
 * Trestle bridges over water: a plank deck on timber stringers, a trestle bent standing in the riverbed under each
 * tile, riveted fascia plates and iron railings, and stone abutments with brass lamp posts where a bridge meets the
 * bank. Rebuilt whenever a road tile changes.
 */
export class BridgeLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private meshes: THREE.Mesh[] = []
  private dirty = true
  private readonly m = new THREE.Matrix4()
  private readonly r = new THREE.Matrix4()

  constructor(terrain: TerrainLayer) {
    this.terrain = terrain
  }

  markDirty(): void {
    this.dirty = true
  }

  update(sim: Simulation): void {
    if (!this.dirty) return
    this.dirty = false
    this.rebuild(sim)
  }

  private rebuild(sim: Simulation): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.meshes = []
    const world = sim.world
    const parts: Record<string, THREE.BufferGeometry[]> = {}
    const deck = this.terrain.deckHeight
    const neighbour = (i: number, d: number) => {
      const x = world.xOf(i) + DIRS[d][0]
      const y = world.yOf(i) + DIRS[d][1]
      return world.inBounds(x, y) ? world.index(x, y) : -1
    }

    for (let i = 0; i < world.size; i++) {
      if (!world.isBridge(i)) continue
      const cx = world.xOf(i) + 0.5
      const cz = world.yOf(i) + 0.5
      const n = DIRS.map((_, d) => neighbour(i, d))
      const bridge = n.map((j) => j >= 0 && world.isBridge(j))
      const land = n.map((j) => j >= 0 && world.isLand(j))
      // Span along the axis with more deck (then more bank) on either side.
      const score = (a: number, b: number) => (Number(bridge[a]) + Number(bridge[b])) * 2 + Number(land[a]) + Number(land[b])
      const alongX = score(0, 2) >= score(1, 3)
      this.r.makeRotationY(alongX ? 0 : -Math.PI / 2)
      // Local frame: +x along the span, z across it, y up from the deck top.
      const add = (mat: string, geo: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
        geo.translate(lx, ly, lz)
        geo.applyMatrix4(this.r)
        geo.applyMatrix4(this.m.makeTranslation(cx, deck, cz))
        ;(parts[mat] ??= []).push(geo.toNonIndexed())
      }
      const bed = this.terrain.heightAt(cx, cz) - deck - 0.05

      add('plank', new THREE.BoxGeometry(1.0, 0.06, 0.8), 0, -0.03, 0)
      for (const s of [-0.3, 0.3]) add('timber', new THREE.BoxGeometry(1.0, 0.09, 0.09), 0, -0.1, s)
      for (const s of [-0.41, 0.41]) add('plate', new THREE.BoxGeometry(1.0, 0.1, 0.025), 0, -0.07, s)

      // Trestle bent: two raked posts down into the riverbed, a cap beam and an iron cross-brace.
      const postLen = -0.14 - bed
      for (const s of [-0.32, 0.32]) {
        const post = new THREE.CylinderGeometry(0.045, 0.055, postLen, 7).rotateX(s > 0 ? -0.08 : 0.08)
        add('timber', post, 0, bed + postLen / 2, s)
      }
      add('timber', new THREE.BoxGeometry(0.1, 0.08, 0.8), 0, -0.18, 0)
      const brace = Math.hypot(0.64, postLen * 0.7)
      add('darkiron', new THREE.BoxGeometry(0.025, brace, 0.025).rotateX(Math.atan2(0.64, postLen * 0.7)), 0, -0.18 - postLen * 0.35, 0)

      // Railings: posts at the tile centre, a top rail and a mid rail along each side.
      for (const s of [-0.38, 0.38]) {
        add('iron', new THREE.BoxGeometry(0.04, 0.3, 0.04), 0, 0.15, s)
        add('brass', new THREE.SphereGeometry(0.03, 8, 6), 0, 0.31, s)
        add('iron', new THREE.BoxGeometry(1.0, 0.03, 0.03), 0, 0.28, s)
        add('iron', new THREE.BoxGeometry(1.0, 0.018, 0.018), 0, 0.14, s)
      }

      // Where the span meets the bank: a stone abutment, a ramp down to the ground and a pair of lamp posts.
      for (const [d, sign] of alongX ? ([[0, 1], [2, -1]] as const) : ([[1, 1], [3, -1]] as const)) {
        if (!land[d]) continue
        const j = n[d]
        const gx = world.xOf(j) + 0.5
        const gz = world.yOf(j) + 0.5
        const edgeGround = this.terrain.heightAt((cx + gx) / 2, (cz + gz) / 2) - deck
        const farGround = this.terrain.heightAt(gx, gz) - deck
        const abut = Math.max(0.12, -edgeGround + 0.12)
        add('stone', new THREE.BoxGeometry(0.22, abut, 0.9), sign * 0.5, -abut / 2 + 0.02 - 0.06, 0)
        const drop = Math.min(0, farGround)
        const len = Math.hypot(0.5, drop)
        add('plank', new THREE.BoxGeometry(len, 0.05, 0.72).rotateZ(sign * Math.atan2(drop, 0.5)), sign * 0.75, drop / 2 - 0.02, 0)
        for (const s of [-0.42, 0.42]) {
          add('darkiron', new THREE.CylinderGeometry(0.025, 0.035, 0.62, 8), sign * 0.5, 0.31, s)
          add('brass', new THREE.CylinderGeometry(0.06, 0.05, 0.03, 8), sign * 0.5, 0.63, s)
          add('lamp', new THREE.BoxGeometry(0.07, 0.09, 0.07), sign * 0.5, 0.69, s)
          add('brass', new THREE.ConeGeometry(0.065, 0.06, 4).rotateY(Math.PI / 4), sign * 0.5, 0.76, s)
        }
      }
    }

    for (const [mat, geos] of Object.entries(parts)) {
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, material(mat))
      mesh.castShadow = mat !== 'lamp'
      mesh.receiveShadow = true
      for (const g of geos) g.dispose()
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose()
  }
}
