import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Simulation } from '../sim/simulation'
import type { Citizen } from '../sim/types'
import type { TerrainLayer } from './terrain'

const SKIN = ['#efcfae', '#d9a982', '#b07a52', '#7a5234'].map((c) => new THREE.Color(c))
const WHITE = new THREE.Color('#ffffff')

/** Paints a geometry with per-vertex colours chosen by height (bands such as belts, boots and hat ribbons). */
function banded(geo: THREE.BufferGeometry, bands: [number, string][]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    let chosen = bands[bands.length - 1][1]
    for (const [top, color] of bands) {
      if (y <= top) {
        chosen = color
        break
      }
    }
    c.set(chosen)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!
}

// Figure proportions (adult, in tiles). Local space: feet at y=0, facing +z.
const HIP_Y = 0.3
const HIP_X = 0.045
const LEG = 0.29
const SHOULDER_Y = 0.57
const SHOULDER_X = 0.09
const ARM = 0.22

function geometries() {
  // Limbs hang down from their pivot at the origin.
  const leg = banded(new THREE.CylinderGeometry(0.03, 0.026, LEG, 7).translate(0, -LEG / 2, 0), [
    [-LEG + 0.06, '#1c1612'],
    [0, '#3c3630'],
  ])
  const boot = new THREE.BoxGeometry(0.06, 0.04, 0.1).translate(0, -LEG + 0.02, 0.02)
  const legWithBoot = merge([leg, banded(boot, [[1, '#1c1612']])])

  const arm = new THREE.CylinderGeometry(0.026, 0.022, ARM, 7).translate(0, -ARM / 2, 0)
  const hand = new THREE.SphereGeometry(0.026, 7, 5).translate(0, -ARM - 0.012, 0)

  // Men: frock coat with a dark belt and brass buttons, plus collar and coat tails.
  const coat = banded(
    merge([
      new THREE.CylinderGeometry(0.075, 0.1, 0.3, 10).translate(0, 0.43, 0),
      new THREE.SphereGeometry(0.083, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.55, 1).translate(0, 0.575, 0),
      new THREE.CylinderGeometry(0.1, 0.115, 0.1, 10, 1, true).translate(0, 0.25, -0.01),
    ]),
    [
      [0.37, '#ffffff'],
      [0.395, '#2a2018'],
      [1, '#ffffff'],
    ],
  )
  const buttons = banded(
    merge([0.45, 0.5, 0.54].map((y) => new THREE.SphereGeometry(0.012, 5, 4).translate(0, y, 0.088))),
    [[1, '#d8a84a']],
  )

  // Women: fitted bodice, full skirt and an apron.
  const dress = banded(
    merge([
      new THREE.CylinderGeometry(0.068, 0.08, 0.2, 10).translate(0, 0.5, 0),
      new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.25, 0.5, 1).translate(0, 0.595, 0),
      new THREE.CylinderGeometry(0.085, 0.165, 0.36, 12).translate(0, 0.22, 0),
    ]),
    [[1, '#ffffff']],
  )
  const apron = banded(new THREE.CylinderGeometry(0.09, 0.15, 0.3, 12, 1, true, -0.9, 1.8).translate(0, 0.24, 0.005), [[1, '#e8e0cc']])

  const head = merge([
    new THREE.SphereGeometry(0.068, 12, 9).scale(1, 1.08, 1).translate(0, 0.685, 0),
    new THREE.CylinderGeometry(0.028, 0.032, 0.05, 7).translate(0, 0.615, 0),
    new THREE.SphereGeometry(0.014, 5, 4).translate(0, 0.68, 0.068),
  ])
  const eyes = banded(
    merge([-0.024, 0.024].map((x) => new THREE.SphereGeometry(0.009, 5, 4).translate(x, 0.7, 0.061))),
    [[1, '#1a1410']],
  )

  const topHat = banded(
    merge([
      new THREE.CylinderGeometry(0.058, 0.062, 0.13, 12).translate(0, 0.81, 0),
      new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14).translate(0, 0.748, 0),
    ]),
    [
      [0.77, '#24201c'],
      [0.79, '#8a5a32'],
      [1, '#24201c'],
    ],
  )
  const bowler = banded(
    merge([
      new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.95, 1).translate(0, 0.745, 0),
      new THREE.CylinderGeometry(0.095, 0.095, 0.01, 14).translate(0, 0.745, 0),
    ]),
    [[1, '#3a2c20']],
  )
  // Bonnet sits on the back of the head and frames the face, with a ribbon tied under the chin.
  const bonnet = merge([
    banded(
      new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-0.95).translate(0, 0.705, -0.022),
      [[1, '#e6dcc4']],
    ),
    banded(new THREE.TorusGeometry(0.066, 0.011, 5, 16, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2).rotateX(0.25).translate(0, 0.665, -0.012), [[1, '#a03a3a']]),
    banded(new THREE.SphereGeometry(0.071, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.32).rotateX(-0.3).translate(0, 0.69, -0.008), [[1, '#5a3a22']]),
  ])
  const cap = banded(
    merge([
      new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.74, 0),
      new THREE.BoxGeometry(0.09, 0.008, 0.06).translate(0, 0.742, 0.075),
    ]),
    [[1, '#5a5048']],
  )
  const load = new THREE.BoxGeometry(0.18, 0.13, 0.13).translate(0, 0.46, 0.17)

  return { legWithBoot, arm, hand, coat, buttons, dress, apron, head, eyes, topHat, bowler, bonnet, cap, load }
}

type Part = keyof ReturnType<typeof geometries>

/** How each part's per-instance colour is chosen. */
const PARTS: { part: Part; tint: 'profession' | 'skin' | 'load' | 'none'; vertexColors: boolean; shadow: boolean }[] = [
  { part: 'legWithBoot', tint: 'none', vertexColors: true, shadow: true },
  { part: 'arm', tint: 'profession', vertexColors: false, shadow: true },
  { part: 'hand', tint: 'skin', vertexColors: false, shadow: false },
  { part: 'coat', tint: 'profession', vertexColors: true, shadow: true },
  { part: 'buttons', tint: 'none', vertexColors: true, shadow: false },
  { part: 'dress', tint: 'profession', vertexColors: true, shadow: true },
  { part: 'apron', tint: 'none', vertexColors: true, shadow: false },
  { part: 'head', tint: 'skin', vertexColors: false, shadow: true },
  { part: 'eyes', tint: 'none', vertexColors: true, shadow: false },
  { part: 'topHat', tint: 'none', vertexColors: true, shadow: true },
  { part: 'bowler', tint: 'none', vertexColors: true, shadow: true },
  { part: 'bonnet', tint: 'none', vertexColors: true, shadow: true },
  { part: 'cap', tint: 'none', vertexColors: true, shadow: true },
  { part: 'load', tint: 'load', vertexColors: false, shadow: true },
]

interface Pose {
  legSwing: number
  armL: number
  armR: number
  bob: number
}

/**
 * Colonists as articulated instanced figures: coats or dresses coloured by profession, hats, swinging limbs while
 * walking, a hammering motion while working and arms forward when carrying. Positions are interpolated between
 * simulation ticks; citizens indoors are hidden.
 */
export class CitizenLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private readonly geos = geometries()
  private readonly mats = new Map<Part, THREE.MeshStandardMaterial>()
  private meshes = new Map<string, THREE.InstancedMesh>()
  private counts = new Map<string, number>()
  private capacity = 0
  private readonly profColors = new Map<string, THREE.Color>()
  private readonly resColors = new Map<string, THREE.Color>()
  private readonly facing = new Map<number, number>()
  private readonly phase = new Map<number, number>()
  private readonly base = new THREE.Matrix4()
  private readonly limb = new THREE.Matrix4()
  private readonly out = new THREE.Matrix4()
  private readonly offset = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private lastTime = 0

  constructor(terrain: TerrainLayer, professions: { id: string; color: string }[], resources: { id: string; color: string }[]) {
    this.terrain = terrain
    for (const p of professions) this.profColors.set(p.id, new THREE.Color(p.color))
    for (const r of resources) this.resColors.set(r.id, new THREE.Color(r.color))
    for (const { part, vertexColors } of PARTS) {
      this.mats.set(part, new THREE.MeshStandardMaterial({ roughness: part === 'buttons' ? 0.3 : 0.82, metalness: part === 'buttons' ? 0.8 : 0, vertexColors }))
    }
    this.allocate(64)
  }

  /** Instanced meshes per part; limbs get a left and a right copy. */
  private allocate(capacity: number): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh)
      mesh.dispose()
    }
    this.meshes.clear()
    this.capacity = capacity
    for (const { part, shadow } of PARTS) {
      const keys = part === 'legWithBoot' || part === 'arm' || part === 'hand' ? [`${part}L`, `${part}R`] : [part]
      for (const key of keys) {
        const mesh = new THREE.InstancedMesh(this.geos[part], this.mats.get(part)!, capacity)
        mesh.castShadow = shadow
        mesh.receiveShadow = false
        mesh.frustumCulled = false
        mesh.count = 0
        this.meshes.set(key, mesh)
        this.group.add(mesh)
      }
    }
  }

  private put(key: string, matrix: THREE.Matrix4, color?: THREE.Color): void {
    const mesh = this.meshes.get(key)!
    const n = this.counts.get(key) ?? 0
    mesh.setMatrixAt(n, matrix)
    mesh.setColorAt(n, color ?? WHITE)
    this.counts.set(key, n + 1)
  }

  /** base × translate(pivot) × rotateX(angle) [× translate(0, -drop, 0)] */
  private limbMatrix(px: number, py: number, angle: number, drop = 0): THREE.Matrix4 {
    this.limb.makeRotationX(angle)
    this.limb.setPosition(px, py, 0)
    this.out.multiplyMatrices(this.base, this.limb)
    if (drop) this.out.multiply(this.offset.makeTranslation(0, -drop, 0))
    return this.out
  }

  private pose(c: Citizen, moving: boolean, time: number, dt: number): Pose {
    const step = c.task?.steps[c.task.i]
    let phase = this.phase.get(c.id) ?? c.id
    if (moving) phase += dt * 11
    this.phase.set(c.id, phase)
    const swing = moving ? Math.sin(phase) : 0
    const pose: Pose = { legSwing: swing * 0.55, armL: -swing * 0.5, armR: swing * 0.5, bob: moving ? Math.abs(Math.cos(phase)) * 0.025 : 0 }
    if (c.carry) {
      pose.armL = pose.armR = -1.15
    } else if (!moving && step?.op === 'work') {
      // Hammering, chopping, digging: both arms beat together.
      const beat = Math.sin(time * 7 + c.id)
      pose.armL = pose.armR = -0.9 - beat * 0.65
      pose.bob = Math.max(0, beat) * 0.015
    }
    return pose
  }

  update(sim: Simulation, alpha: number, time: number): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime))
    this.lastTime = time
    if (sim.citizens.size > this.capacity) this.allocate(Math.ceil(sim.citizens.size * 1.5))
    this.counts.clear()
    const adultMonths = sim.rules.citizen.adultAge * 12
    for (const c of sim.citizens.values()) {
      if (c.inside) continue
      const x = c.px + (c.x - c.px) * alpha
      const y = c.py + (c.y - c.py) * alpha
      const dx = c.x - c.px
      const dy = c.y - c.py
      const moving = dx * dx + dy * dy > 1e-7
      let heading = this.facing.get(c.id) ?? 0
      if (moving) {
        const target = Math.atan2(dx, dy)
        // Turn smoothly rather than snapping between path segments.
        let delta = target - heading
        delta = Math.atan2(Math.sin(delta), Math.cos(delta))
        heading += delta * Math.min(1, dt * 14)
        this.facing.set(c.id, heading)
      }
      const child = c.age < adultMonths
      const scale = child ? 0.6 + (0.4 * c.age) / adultMonths : 1
      const pose = this.pose(c, moving, time, dt)
      this.p.set(x, this.terrain.heightAt(x, y) + pose.bob, y)
      this.q.setFromAxisAngle(this.up, heading)
      this.s.set(scale, scale, scale)
      this.base.compose(this.p, this.q, this.s)

      const coat = this.profColors.get(c.profession) ?? this.profColors.get('laborer')!
      const skin = SKIN[c.id % SKIN.length]

      this.put('legWithBootL', this.limbMatrix(-HIP_X, HIP_Y, pose.legSwing))
      this.put('legWithBootR', this.limbMatrix(HIP_X, HIP_Y, -pose.legSwing))
      this.put('armL', this.limbMatrix(-SHOULDER_X, SHOULDER_Y, pose.armL), coat)
      this.put('armR', this.limbMatrix(SHOULDER_X, SHOULDER_Y, pose.armR), coat)
      this.put('handL', this.limbMatrix(-SHOULDER_X, SHOULDER_Y, pose.armL), skin)
      this.put('handR', this.limbMatrix(SHOULDER_X, SHOULDER_Y, pose.armR), skin)
      if (c.female) {
        this.put('dress', this.base, coat)
        if (!child) this.put('apron', this.base)
      } else {
        this.put('coat', this.base, coat)
        this.put('buttons', this.base)
      }
      this.put('head', this.base, skin)
      this.put('eyes', this.base)
      this.put(child ? 'cap' : c.female ? 'bonnet' : c.id % 3 === 0 ? 'bowler' : c.id % 3 === 1 ? 'topHat' : 'cap', this.base)
      if (c.carry) {
        const res = Object.keys(c.carry)[0]
        this.put('load', this.base, this.resColors.get(res) ?? WHITE)
      }
    }
    for (const [key, mesh] of this.meshes) {
      mesh.count = this.counts.get(key) ?? 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** Nearest visible citizen within `radius` tiles of a ground point. */
  pick(sim: Simulation, x: number, y: number, radius = 0.6): number {
    let best = 0
    let bestD = radius * radius
    for (const c of sim.citizens.values()) {
      if (c.inside) continue
      const d = (c.x - x) ** 2 + (c.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = c.id
      }
    }
    return best
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.dispose()
    for (const g of Object.values(this.geos)) g.dispose()
    for (const m of this.mats.values()) m.dispose()
  }
}
