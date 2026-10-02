import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ModelPart, ModelSpec } from '../../api/types'
import { material } from './materials'

/**
 * Builds building meshes from the declarative part lists in buildings.json. Static parts are merged per material
 * (few draw calls); spinning gears and furnace glows stay separate so they can animate. Models are cached per
 * building id and cloned (geometry and materials are shared).
 */

export interface BuiltModel {
  group: THREE.Group
  /** Meshes that rotate while the building works, with their spin rate (rad/s) in userData.spin. */
  gears: THREE.Mesh[]
  glows: THREE.Mesh[]
  /** Local positions of chimney tops (smoke and steam emitters). */
  chimneys: THREE.Vector3[]
  height: number
}

function gableGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2
  const z = d / 2
  // Two roof slopes and two gable ends; ridge along x.
  const v = [
    // left slope (-z)
    -x, 0, -z, x, 0, -z, x, h, 0, -x, 0, -z, x, h, 0, -x, h, 0,
    // right slope (+z)
    x, 0, z, -x, 0, z, -x, h, 0, x, 0, z, -x, h, 0, x, h, 0,
    // gable ends
    -x, 0, z, -x, 0, -z, -x, h, 0, x, 0, -z, x, 0, z, x, h, 0,
    // underside
    -x, 0, -z, -x, 0, z, x, 0, z, -x, 0, -z, x, 0, z, x, 0, -z,
  ]
  const uv = [0, 0, w, 0, w, d / 1.4, 0, 0, w, d / 1.4, 0, d / 1.4, 0, 0, w, 0, w, d / 1.4, 0, 0, w, d / 1.4, 0, d / 1.4, 0, 0, d, 0, d / 2, h, 0, 0, d, 0, d / 2, h, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]
  // The vertices above are listed clockwise seen from outside; swap the last two of each triangle so every face
  // winds counter-clockwise (front-facing) and computeVertexNormals points the normals outward.
  for (let t = 0; t < v.length / 9; t++) {
    for (let k = 0; k < 3; k++) [v[t * 9 + 3 + k], v[t * 9 + 6 + k]] = [v[t * 9 + 6 + k], v[t * 9 + 3 + k]]
    for (let k = 0; k < 2; k++) [uv[t * 6 + 2 + k], uv[t * 6 + 4 + k]] = [uv[t * 6 + 4 + k], uv[t * 6 + 2 + k]]
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

function hipGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const x = w / 2
  const z = d / 2
  const r = Math.max(0, (w - d) / 2)
  const v = [
    // front and back trapezoids
    -x, 0, z, x, 0, z, r, h, 0, -x, 0, z, r, h, 0, -r, h, 0,
    x, 0, -z, -x, 0, -z, -r, h, 0, x, 0, -z, -r, h, 0, r, h, 0,
    // side triangles
    x, 0, z, x, 0, -z, r, h, 0,
    -x, 0, -z, -x, 0, z, -r, h, 0,
  ]
  const uv: number[] = []
  for (let i = 0; i < v.length; i += 3) uv.push(v[i] + x, v[i + 1] * 1.4)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

function gearGeometry(diameter: number, thickness: number): THREE.BufferGeometry {
  const teeth = Math.max(8, Math.round(diameter * 14))
  const outer = diameter / 2
  const inner = outer * 0.82
  const shape = new THREE.Shape()
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2
    const a1 = ((i + 0.25) / teeth) * Math.PI * 2
    const a2 = ((i + 0.5) / teeth) * Math.PI * 2
    const a3 = ((i + 0.75) / teeth) * Math.PI * 2
    if (i === 0) shape.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner)
    shape.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer)
    shape.lineTo(Math.cos(a2) * outer, Math.sin(a2) * outer)
    shape.lineTo(Math.cos(a3) * inner, Math.sin(a3) * inner)
    shape.lineTo(Math.cos(a0 + (Math.PI * 2) / teeth) * inner, Math.sin(a0 + (Math.PI * 2) / teeth) * inner)
  }
  // Spoked hub: cut-outs between spokes.
  const holes = 5
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2
    const hole = new THREE.Path()
    hole.absarc(Math.cos(a) * inner * 0.55, Math.sin(a) * inner * 0.55, inner * 0.22, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.2, bevelSize: thickness * 0.2, bevelSegments: 1, curveSegments: 6 })
  g.translate(0, 0, -thickness / 2)
  return g
}

/** Re-projects UVs from position (box projection) so textures keep a constant world scale on every part. */
function boxProjectUVs(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g
  geo.computeVertexNormals()
  const pos = geo.getAttribute('position')
  const nrm = geo.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i))
    const ny = Math.abs(nrm.getY(i))
    const nz = Math.abs(nrm.getZ(i))
    let u: number
    let v: number
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i)
      v = pos.getZ(i)
    } else if (nx >= nz) {
      u = pos.getZ(i)
      v = pos.getY(i)
    } else {
      u = pos.getX(i)
      v = pos.getY(i)
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const [sx, sy, sz] = p.size
  const axis = p.axis ?? 'y'
  let g: THREE.BufferGeometry
  // Vertical parts are positioned by their base; parts lying on x/z and spheres/gears by their centre.
  let lift = 0
  switch (p.shape) {
    case 'box':
      g = new THREE.BoxGeometry(sx, sy, sz)
      lift = sy / 2
      break
    case 'chimney': {
      const shaft = new THREE.BoxGeometry(sx, sy, sz)
      const cap = new THREE.BoxGeometry(sx * 1.35, 0.08, sz * 1.35).translate(0, sy / 2, 0)
      g = mergeGeometries([shaft.toNonIndexed(), cap.toNonIndexed()])!
      lift = sy / 2
      break
    }
    case 'cylinder':
      g = new THREE.CylinderGeometry((sx / 2) * (p.taper ?? 1), sx / 2, sy, 18)
      if (axis === 'y') lift = sy / 2
      break
    case 'cone':
      g = new THREE.ConeGeometry(sx / 2, sy, 18)
      lift = sy / 2
      break
    case 'sphere':
      g = new THREE.SphereGeometry(0.5, 16, 12).scale(sx, sy, sz)
      break
    case 'gable':
      g = gableGeometry(sx, sy, sz)
      break
    case 'hip':
      g = hipGeometry(sx, sy, sz)
      break
    case 'gear':
      g = gearGeometry(sx, sy)
      if (axis === 'y') g.rotateX(Math.PI / 2)
      else if (axis === 'x') g.rotateY(Math.PI / 2)
      break
  }
  if (p.shape === 'cylinder') {
    if (axis === 'x') g.rotateZ(Math.PI / 2)
    else if (axis === 'z') g.rotateX(Math.PI / 2)
  }
  if (lift) g.translate(0, lift, 0)
  if (p.rot) g.rotateY((p.rot * Math.PI) / 180)
  return g
}

const cache = new Map<string, BuiltModel>()

function build(spec: ModelSpec): BuiltModel {
  const group = new THREE.Group()
  const buckets = new Map<string, THREE.BufferGeometry[]>()
  const gears: THREE.Mesh[] = []
  const glows: THREE.Mesh[] = []
  const chimneys: THREE.Vector3[] = []
  let height = 0

  for (const p of spec.parts) {
    const [x, y, z] = p.pos
    const g = partGeometry(p)
    g.computeBoundingBox()
    height = Math.max(height, y + g.boundingBox!.max.y)
    if (p.shape === 'chimney') chimneys.push(new THREE.Vector3(x, y + p.size[1] + 0.1, z))
    if ((p.shape === 'gear' && p.spin) || p.glow) {
      const mesh = new THREE.Mesh(g, material(p.mat))
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.userData.spin = p.spin ?? 0
      mesh.userData.axis = p.axis ?? 'y'
      ;(p.glow ? glows : gears).push(mesh)
      group.add(mesh)
      continue
    }
    g.translate(x, y, z)
    const list = buckets.get(p.mat) ?? []
    list.push(boxProjectUVs(g))
    buckets.set(p.mat, list)
  }

  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))
    if (!merged) continue
    const mesh = new THREE.Mesh(merged, material(mat))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return { group, gears, glows, chimneys, height }
}

/** A fresh instance of a building's model (shared geometry and materials). */
export function buildingModel(defId: string, spec: ModelSpec): BuiltModel {
  let base = cache.get(defId)
  if (!base) {
    base = build(spec)
    cache.set(defId, base)
  }
  const group = base.group.clone(true)
  const gears: THREE.Mesh[] = []
  const glows: THREE.Mesh[] = []
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (base.gears.some((g) => g.geometry === o.geometry)) gears.push(o)
    if (base.glows.some((g) => g.geometry === o.geometry)) glows.push(o)
  })
  return { group, gears, glows, chimneys: base.chimneys, height: base.height }
}

/** Scaffold frame drawn around construction sites. */
export function scaffold(w: number, d: number, h: number): THREE.Group {
  const group = new THREE.Group()
  const mat = material('timber')
  const post = new THREE.BoxGeometry(0.08, h, 0.08).translate(0, h / 2, 0)
  const beamX = new THREE.BoxGeometry(w, 0.06, 0.06)
  const beamZ = new THREE.BoxGeometry(0.06, 0.06, d)
  const geos: THREE.BufferGeometry[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) geos.push(post.clone().translate((sx * w) / 2, 0, (sz * d) / 2))
  }
  for (let level = 1; level <= Math.max(1, Math.floor(h / 0.8)); level++) {
    const y = Math.min(h, level * 0.8)
    for (const s of [-1, 1]) {
      geos.push(beamX.clone().translate(0, y, (s * d) / 2))
      geos.push(beamZ.clone().translate((s * w) / 2, y, 0))
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed()))!, mat)
  mesh.castShadow = true
  group.add(mesh)
  return group
}

/** Flat arrow lying on the ground, pointing along +z (towards a building through its entrance). */
export function entranceArrowGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.32)
  shape.lineTo(0.28, -0.12)
  shape.lineTo(0.1, -0.12)
  shape.lineTo(0.1, -0.32)
  shape.lineTo(-0.1, -0.32)
  shape.lineTo(-0.1, -0.12)
  shape.lineTo(-0.28, -0.12)
  shape.closePath()
  return new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2)
}
