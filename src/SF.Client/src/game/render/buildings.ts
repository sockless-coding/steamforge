import * as THREE from 'three'
import { fieldCrop } from '../sim/components/field'
import { deliveredFraction, totalWork } from '../sim/placement'
import type { Simulation } from '../sim/simulation'
import type { Building } from '../sim/types'
import { idleGlow, material } from './materials'
import { buildingModel, entranceArrowGeometry, scaffold, type BuiltModel } from './models'
import type { Particles } from './particles'
import type { TerrainLayer } from './terrain'

interface BuildingView {
  id: number
  group: THREE.Group
  model: BuiltModel | null
  scaffold: THREE.Group | null
  field: FieldView | null
  piles: THREE.Mesh[]
  wasSite: boolean
  fireLight: THREE.PointLight | null
  emitAcc: number
  ventAcc: number
  indicator: THREE.Sprite | null
  /** Translucent full-size model and ground outline shown while the building is only planned. */
  blueprint: THREE.Group | null
  outline: THREE.Group | null
}

interface FieldView {
  soil: THREE.Mesh
  crops: THREE.InstancedMesh
  version: string
}

const cropGeometry = (() => {
  const blades = [0, 1, 2].map((i) => new THREE.ConeGeometry(0.08, 0.5, 4).translate(Math.cos(i * 2.1) * 0.12, 0.25, Math.sin(i * 2.1) * 0.12))
  const merged = new THREE.BufferGeometry()
  const positions: number[] = []
  for (const b of blades) {
    const p = b.toNonIndexed().getAttribute('position')
    for (let i = 0; i < p.count * 3; i++) positions.push(p.array[i])
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.computeVertexNormals()
  return merged
})()

const pileGeometry = new THREE.BoxGeometry(0.7, 1, 0.7).translate(0, 0.5, 0)

const blueprintFill = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.16, depthWrite: false })
const blueprintEdges = new THREE.LineBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.85, depthWrite: false })
const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
const outlineFillMaterial = new THREE.MeshBasicMaterial({ color: '#8fd8ff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
const doorMaterial = new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
const roadPlanMaterial = new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.45, depthWrite: false })
const roadPlanGeometry = new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2)
const blueprintCache = new Map<string, THREE.Group>()

type IndicatorKind = 'power' | 'fuel'
const indicatorMaterials = new Map<IndicatorKind, THREE.SpriteMaterial>()

/** Brass-rimmed badge: a lightning bolt (no energy) or a guttering flame (no fuel). Drawn once on a canvas. */
function indicatorMaterial(kind: IndicatorKind): THREE.SpriteMaterial {
  let m = indicatorMaterials.get(kind)
  if (m) return m
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  ctx.fillStyle = '#d4a24a'
  ctx.beginPath()
  ctx.arc(c, c, c - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2a1e16'
  ctx.beginPath()
  ctx.arc(c, c, c - 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = kind === 'power' ? '#ffd23a' : '#ff6a2a'
  ctx.beginPath()
  if (kind === 'power') {
    const pts = [[54, 16], [28, 52], [46, 52], [40, 80], [68, 40], [50, 40], [58, 16]]
    ctx.moveTo(pts[0][0], pts[0][1])
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
  } else {
    ctx.moveTo(48, 18)
    ctx.bezierCurveTo(70, 40, 70, 58, 62, 70)
    ctx.bezierCurveTo(56, 80, 40, 80, 34, 70)
    ctx.bezierCurveTo(26, 56, 34, 44, 42, 36)
    ctx.bezierCurveTo(42, 46, 46, 50, 50, 52)
    ctx.bezierCurveTo(52, 40, 48, 30, 48, 18)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#e04030'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(22, 74)
  ctx.lineTo(74, 22)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  m = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })
  indicatorMaterials.set(kind, m)
  return m
}

/** Wireframe-and-glass version of a building model: what a planned building will look like. */
function blueprintModel(defId: string, model: BuiltModel): THREE.Group {
  let base = blueprintCache.get(defId)
  if (!base) {
    const group = new THREE.Group()
    model.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const fill = new THREE.Mesh(o.geometry, blueprintFill)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), blueprintEdges)
      for (const part of [fill, edges]) {
        part.position.copy(o.position)
        part.rotation.copy(o.rotation)
        part.renderOrder = 3
        group.add(part)
      }
    })
    blueprintCache.set(defId, group)
    base = group
  }
  return base.clone(true)
}

/** Syncs one Three.js group per simulation building and animates gears, glows, smoke, fire and construction. */
export class BuildingLayer {
  readonly group = new THREE.Group()
  private readonly views = new Map<number, BuildingView>()
  private readonly terrain: TerrainLayer
  private readonly particles: Particles
  private readonly soilMat = new THREE.MeshStandardMaterial({ color: '#5e4630', roughness: 1 })
  private readonly cropMats = new Map<string, THREE.MeshStandardMaterial>()
  private readonly pileMats = new Map<string, THREE.MeshStandardMaterial>()
  private readonly matrix = new THREE.Matrix4()
  private readonly selection: THREE.Mesh
  private roadPlans: THREE.InstancedMesh
  private roadPlanKey = ''
  selected = 0

  constructor(terrain: TerrainLayer, particles: Particles) {
    this.terrain = terrain
    this.particles = particles
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.85, depthWrite: false }),
    )
    this.selection.visible = false
    this.selection.renderOrder = 5
    this.roadPlans = this.makeRoadPlans(512)
    this.group.add(this.selection)
  }

  private makeRoadPlans(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(roadPlanGeometry, roadPlanMaterial, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    this.group.add(mesh)
    return mesh
  }

  /** Creates, updates and removes views to match the simulation. Cheap: runs every frame. */
  sync(sim: Simulation, time: number, dt: number): void {
    for (const [id, view] of this.views) {
      if (!sim.buildings.has(id)) this.remove(view)
    }
    for (const b of sim.buildings.values()) {
      let view = this.views.get(b.id)
      if (!view) view = this.create(sim, b)
      this.animate(sim, b, view, time, dt)
    }
    const sel = sim.buildings.get(this.selected)
    this.selection.visible = !!sel
    if (sel) {
      const r = Math.max(sel.w, sel.h) * 0.75 + 0.3
      this.selection.scale.set(r, 1, r)
      this.selection.position.set(sel.x + sel.w / 2, sel.baseHeight + 0.06 + Math.sin(time * 3) * 0.02, sel.y + sel.h / 2)
    }
    // Planned buildings and roads pulse gently so they stand out on a paused map.
    const pulse = 0.5 + 0.5 * Math.sin(time * 3)
    blueprintFill.opacity = 0.12 + 0.08 * pulse
    outlineMaterial.opacity = 0.65 + 0.35 * pulse
    roadPlanMaterial.opacity = 0.3 + 0.25 * pulse
    this.syncRoadPlans(sim)
  }

  /** Markers on road tiles that are ordered but not yet laid. */
  private syncRoadPlans(sim: Simulation): void {
    let key = `${sim.roadJobs.size}`
    for (const tile of sim.roadJobs.keys()) key += `,${tile}`
    if (key === this.roadPlanKey) return
    this.roadPlanKey = key
    if (sim.roadJobs.size > this.roadPlans.instanceMatrix.count) {
      this.group.remove(this.roadPlans)
      this.roadPlans.dispose()
      this.roadPlans = this.makeRoadPlans(sim.roadJobs.size * 2)
    }
    const world = sim.world
    let n = 0
    for (const tile of sim.roadJobs.keys()) {
      const x = world.xOf(tile) + 0.5
      const y = world.yOf(tile) + 0.5
      this.matrix.makeTranslation(x, this.terrain.heightAt(x, y) + 0.07, y)
      this.roadPlans.setMatrixAt(n++, this.matrix)
    }
    this.roadPlans.count = n
    this.roadPlans.instanceMatrix.needsUpdate = true
  }

  /** Gold footprint line following the ground, plus an arrow on the entrance tile. */
  private makeOutline(sim: Simulation, b: Building): THREE.Group {
    const group = new THREE.Group()
    const t = this.terrain
    // A ribbon border and a faint fill, both draped over the ground (WebGL lines are only one pixel wide).
    const border: number[] = []
    const fill: number[] = []
    const h = (x: number, y: number) => t.heightAt(x, y) + 0.06
    const quad = (out: number[], ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
      out.push(ax, h(ax, ay), ay, cx, h(cx, cy), cy, bx, h(bx, by), by, bx, h(bx, by), by, cx, h(cx, cy), cy, dx, h(dx, dy), dy)
    }
    const width = 0.12
    const x0 = b.x
    const y0 = b.y
    const x1 = b.x + b.w
    const y1 = b.y + b.h
    const step = 0.25
    for (let x = x0; x < x1 - 1e-6; x += step) {
      const xe = Math.min(x1, x + step)
      quad(border, x, y0, xe, y0, x, y0 + width, xe, y0 + width)
      quad(border, x, y1 - width, xe, y1 - width, x, y1, xe, y1)
    }
    for (let y = y0 + width; y < y1 - width - 1e-6; y += step) {
      const ye = Math.min(y1 - width, y + step)
      quad(border, x0, y, x0 + width, y, x0, ye, x0 + width, ye)
      quad(border, x1 - width, y, x1, y, x1 - width, ye, x1, ye)
    }
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) quad(fill, x, y, x + 1, y, x, y + 1, x + 1, y + 1)
    const borderMesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(border, 3)), outlineMaterial)
    const fillMesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fill, 3)), outlineFillMaterial)
    borderMesh.renderOrder = 4
    fillMesh.renderOrder = 3
    group.add(fillMesh, borderMesh)

    if (!sim.def(b).walkable) {
      const w = sim.world
      const dx = w.xOf(b.door) + 0.5
      const dy = w.yOf(b.door) + 0.5
      // Flat on the ground on the entrance tile, pointing into the building.
      const arrow = new THREE.Mesh(entranceArrowGeometry(), doorMaterial)
      arrow.position.set(dx, t.heightAt(dx, dy) + 0.08, dy)
      arrow.rotation.y = Math.atan2(dx - (b.x + b.w / 2), dy - (b.y + b.h / 2)) + Math.PI
      arrow.renderOrder = 4
      group.add(arrow)
    }
    return group
  }

  private clearPlan(view: BuildingView): void {
    if (view.blueprint) view.group.remove(view.blueprint)
    if (view.outline) {
      this.group.remove(view.outline)
      view.outline.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
    }
    view.blueprint = null
    view.outline = null
  }

  private create(sim: Simulation, b: Building): BuildingView {
    const group = new THREE.Group()
    group.position.set(b.x + b.w / 2, b.baseHeight, b.y + b.h / 2)
    group.rotation.y = (b.rot * Math.PI) / 2
    const view: BuildingView = {
      id: b.id,
      group,
      model: null,
      scaffold: null,
      field: null,
      piles: [],
      wasSite: !!b.site,
      fireLight: null,
      emitAcc: Math.random(),
      ventAcc: Math.random(),
      indicator: null,
      blueprint: null,
      outline: null,
    }
    const def = sim.def(b)
    if (def.components.field) {
      group.position.set(0, 0, 0)
      group.rotation.y = 0
    } else {
      view.model = buildingModel(def.id, def.model)
      group.add(view.model.group)
      if (b.site) {
        view.blueprint = blueprintModel(def.id, view.model)
        group.add(view.blueprint)
      }
    }
    if (b.site) {
      view.outline = this.makeOutline(sim, b)
      this.group.add(view.outline)
    }
    this.views.set(b.id, view)
    this.group.add(group)
    return view
  }

  private remove(view: BuildingView): void {
    this.clearPlan(view)
    this.group.remove(view.group)
    if (view.field) {
      view.field.soil.geometry.dispose()
      view.field.crops.dispose()
    }
    for (const p of view.piles) p.removeFromParent()
    this.views.delete(view.id)
  }

  private animate(sim: Simulation, b: Building, view: BuildingView, time: number, dt: number): void {
    const def = sim.def(b)
    if (!b.site && view.outline) this.clearPlan(view)
    if (def.components.field) {
      this.updateField(sim, b, view)
      return
    }
    const model = view.model!
    if (b.site) {
      const progress = b.site.stage === 'clearing' ? 0 : Math.min(1, b.site.work / totalWork(sim, b))
      model.group.scale.set(1, Math.max(0.02, progress), 1)
      model.group.visible = progress > 0.01
      if (!view.scaffold) {
        const w = b.rot % 2 ? b.h : b.w
        const d = b.rot % 2 ? b.w : b.h
        view.scaffold = scaffold(w * 0.92, d * 0.92, Math.max(0.6, model.height * 0.9))
        view.group.add(view.scaffold)
      }
      view.scaffold.visible = b.site.stage === 'building' && deliveredFraction(sim, b) > 0
      return
    }
    if (view.wasSite) {
      view.wasSite = false
      model.group.scale.set(1, 1, 1)
      model.group.visible = true
      if (view.scaffold) {
        view.group.remove(view.scaffold)
        view.scaffold = null
      }
      for (let i = 0; i < 14; i++) this.particles.emit('dust', view.group.position.x, b.baseHeight + 0.2, view.group.position.z, Math.max(b.w, b.h) * 0.8)
    }

    const working = sim.second - b.activeAt <= 2
    for (const gear of model.gears) {
      if (!working) continue
      const spin = (gear.userData.spin as number) * dt
      if (gear.userData.axis === 'x') gear.rotation.x += spin
      else if (gear.userData.axis === 'y') gear.rotation.y += spin
      else gear.rotation.z += spin
    }
    for (const bob of model.bobs) {
      const stroke = working ? 0.5 + 0.5 * Math.sin(time * (bob.userData.rate as number) + b.id) : 1
      bob.position.y = (bob.userData.baseY as number) + (bob.userData.bob as number) * stroke
    }
    for (const glow of model.glows) glow.material = working ? material(glow.userData.mat as string) : idleGlow(glow.userData.mat as string)

    // Chimney smoke: homes when heated in the cold, workplaces while working (generators while lit), the
    // headquarters always. Steam vents puff in bursts while the building works.
    const isHome = !!def.components.housing
    const homeFire = b.residents.length > 0 && b.data.heated !== false && b.data.heat === undefined
    const always = !!def.components.shelter && !def.components.generator
    const smoking = b.fire === 0 && (isHome ? homeFire : working || always)
    const venting = b.fire === 0 && (isHome ? b.data.heat !== undefined && b.residents.length > 0 : working)
    view.emitAcc += dt * (smoking ? 2.4 : 0)
    view.ventAcc += dt * (venting ? 1.6 : 0)
    const puff = (kind: 'smoke' | 'steam') => {
      for (const e of model.emitters) {
        if (e.kind !== kind) continue
        const p = e.pos.clone().applyEuler(view.group.rotation).add(view.group.position)
        this.particles.emit(kind, p.x, p.y, p.z)
      }
    }
    while (view.emitAcc >= 1) {
      view.emitAcc -= 1
      puff('smoke')
    }
    while (view.ventAcc >= 1) {
      view.ventAcc -= 1
      // Irregular hiss: skip some puffs, double others.
      if (Math.random() < 0.7) puff('steam')
      if (Math.random() < 0.25) puff('steam')
    }
    this.updateIndicator(sim, b, view, model, time)

    if (def.model.piles) this.updatePiles(sim, b, view)

    if (b.fire > 0) {
      if (!view.fireLight) {
        view.fireLight = new THREE.PointLight('#ff7a2a', 6, 8, 1.5)
        view.fireLight.position.set(0, model.height * 0.7, 0)
        view.group.add(view.fireLight)
      }
      view.fireLight.intensity = 5 + Math.sin(time * 23) * 1.5 + Math.sin(time * 37) * 1
      for (let i = 0; i < 3; i++) {
        this.particles.emit('fire', view.group.position.x, b.baseHeight + Math.random() * model.height, view.group.position.z, Math.max(b.w, b.h) * 0.8)
      }
      this.particles.emit('smoke', view.group.position.x, b.baseHeight + model.height, view.group.position.z, Math.max(b.w, b.h) * 0.5)
    } else if (view.fireLight) {
      view.group.remove(view.fireLight)
      view.fireLight.dispose()
      view.fireLight = null
    }
  }

  /** A floating badge over buildings that cannot work: no energy for required consumers, or a cold generator. */
  private updateIndicator(sim: Simulation, b: Building, view: BuildingView, model: BuiltModel, time: number): void {
    const def = sim.def(b)
    const consumer = def.components.consumer as { required?: boolean } | undefined
    const generator = def.components.generator as { fuel?: Record<string, number> } | undefined
    const staffed = !def.components.workplace || b.workers.length > 0
    let kind: IndicatorKind | null = null
    if (b.fire === 0 && staffed) {
      if (consumer?.required && ((b.data.power as number | undefined) ?? 0) < 0.5) kind = 'power'
      else if (generator?.fuel && b.data.lit === false) kind = 'fuel'
    }
    if (!kind) {
      if (view.indicator) view.indicator.visible = false
      return
    }
    if (!view.indicator) {
      view.indicator = new THREE.Sprite(indicatorMaterial(kind))
      view.indicator.scale.set(0.75, 0.75, 1)
      view.indicator.renderOrder = 7
      view.group.add(view.indicator)
    }
    view.indicator.material = indicatorMaterial(kind)
    view.indicator.visible = true
    view.indicator.position.set(0, model.height + 0.55 + Math.sin(time * 3 + b.id) * 0.08, 0)
  }

  private updatePiles(sim: Simulation, b: Building, view: BuildingView): void {
    const entries = Object.entries(b.stock).filter(([, q]) => q >= 1).sort((a, z) => z[1] - a[1]).slice(0, 9)
    while (view.piles.length < entries.length) {
      const mesh = new THREE.Mesh(pileGeometry, material('timber'))
      mesh.castShadow = true
      view.group.add(mesh)
      view.piles.push(mesh)
    }
    const w = b.rot % 2 ? b.h : b.w
    const d = b.rot % 2 ? b.w : b.h
    view.piles.forEach((mesh, i) => {
      const entry = entries[i]
      mesh.visible = !!entry
      if (!entry) return
      const [res, qty] = entry
      let mat = this.pileMats.get(res)
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ color: sim.resource(res)?.color ?? '#888', roughness: 0.85 })
        this.pileMats.set(res, mat)
      }
      mesh.material = mat
      const col = i % 3
      const row = Math.floor(i / 3)
      mesh.position.set((col - 1) * (w / 3.2), 0.05, (row - 1) * (d / 3.2))
      mesh.scale.set(w / 4.4, Math.min(1.2, 0.1 + qty / 80), d / 4.4)
    })
  }

  private updateField(sim: Simulation, b: Building, view: BuildingView): void {
    const plots = (b.data.plots as number[] | undefined) ?? []
    const growth = (b.data.growth as number | undefined) ?? 0
    const crop = b.site ? null : fieldCrop(sim, b)
    const version = `${b.site ? 'site' : ''}|${plots.join('')}|${growth.toFixed(2)}|${crop?.id}`
    if (view.field?.version === version) return
    if (!view.field) {
      const positions: number[] = []
      const t = this.terrain
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const q = (px: number, py: number) => [px, t.heightAt(px, py) + 0.04, py]
          const a = q(x + 0.04, y + 0.04)
          const bb = q(x + 0.96, y + 0.04)
          const c = q(x + 0.04, y + 0.96)
          const d = q(x + 0.96, y + 0.96)
          positions.push(...a, ...c, ...bb, ...bb, ...c, ...d)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.computeVertexNormals()
      const soil = new THREE.Mesh(geo, this.soilMat)
      soil.receiveShadow = true
      const crops = new THREE.InstancedMesh(cropGeometry, this.soilMat, b.w * b.h)
      crops.castShadow = true
      view.group.add(soil, crops)
      view.field = { soil, crops, version: '' }
    }
    const field = view.field
    field.version = version
    field.soil.material = this.soilMat
    if (!crop) {
      field.crops.count = 0
      return
    }
    let mat = this.cropMats.get(crop.id)
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: crop.color, roughness: 0.8 })
      this.cropMats.set(crop.id, mat)
    }
    field.crops.material = mat
    let n = 0
    const s = 0.25 + growth * 0.9
    for (let k = 0; k < plots.length; k++) {
      if (plots[k] !== 1) continue
      const x = b.x + (k % b.w) + 0.5
      const y = b.y + Math.floor(k / b.w) + 0.5
      this.matrix.makeScale(s, s, s).setPosition(x, this.terrain.heightAt(x, y) + 0.02, y)
      field.crops.setMatrixAt(n++, this.matrix)
    }
    field.crops.count = n
    field.crops.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    for (const view of [...this.views.values()]) this.remove(view)
    this.soilMat.dispose()
  }
}
