import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ConduitStyle } from '../../api/types'
import { gradeIndex, networkIndex, participates, tileGrade } from '../sim/energy'
import type { Simulation } from '../sim/simulation'
import { material } from './materials'
import type { Particles } from './particles'
import type { TerrainLayer } from './terrain'

/** Height above the ground of each conduit style's centre line (citizens walk under mains and wires). */
const STYLE_Y: Record<ConduitStyle, number> = { duct: 0.12, water: 0.08, main: 0.62, lagged: 0.62, wire: 1.42 }
/** Pipe radius per style. */
const STYLE_R: Record<ConduitStyle, number> = { duct: 0.07, water: 0.055, main: 0.075, lagged: 0.1, wire: 0.012 }
/** Pipe material per style. */
const STYLE_MAT: Record<ConduitStyle, string> = { duct: 'tile', water: 'darkiron', main: 'plate', lagged: 'copper', wire: 'copper' }

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

const UP = new THREE.Vector3(0, 1, 0)

/** A cylinder running from a to b (merged into the network mesh). */
function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, sides = 8): THREE.BufferGeometry {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const g = new THREE.CylinderGeometry(radius, radius, len, sides, 1, true)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g.toNonIndexed()
}

/** A ring around a pipe at a point, facing along the x or z axis. */
function band(centre: THREE.Vector3, along: 'x' | 'z', radius: number, width = 0.06): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, 10)
  g.rotateZ(along === 'x' ? Math.PI / 2 : 0).rotateX(along === 'z' ? Math.PI / 2 : 0)
  return g.translate(centre.x, centre.y, centre.z).toNonIndexed()
}

/** Geometry collected per material, merged into one mesh each. */
class Buckets {
  readonly parts = new Map<string, THREE.BufferGeometry[]>()

  add(mat: string, g: THREE.BufferGeometry): void {
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    list.push(g)
  }
}

/** One network's built conduits, merged per material. */
interface NetworkMesh {
  meshes: THREE.Mesh[]
  /** Junction positions on live steam mains, for the occasional hiss of a valve. */
  joints: THREE.Vector3[]
}

/**
 * Draws laid conduits from World.conduit in the style of each tile's grade: clay steam ducts in timber troughs,
 * riveted iron mains on trestles (with brass flanges and valve wheels at junctions), copper-sheathed lagged mains,
 * low cast-iron water mains with hydrants, and copper power lines strung between insulated poles. Where two grades
 * of different height meet, a riser joins them. Conduits reach into the buildings they serve. Planned conduits show
 * as pulsing markers. Rebuilt only when a 'conduit' or building event marks it dirty.
 */
export class ConduitLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private readonly particles: Particles
  private nets: NetworkMesh[] = []
  private dirty = true
  private plans: THREE.InstancedMesh
  private planKey = ''
  private readonly planMaterials: THREE.MeshBasicMaterial[] = []
  private readonly matrix = new THREE.Matrix4()
  private readonly color = new THREE.Color()
  private hissAcc = 0

  constructor(terrain: TerrainLayer, particles: Particles) {
    this.terrain = terrain
    this.particles = particles
    this.plans = this.makePlans(256)
  }

  markDirty(): void {
    this.dirty = true
  }

  private makePlans(capacity: number): THREE.InstancedMesh {
    const geo = new THREE.BoxGeometry(0.34, 0.08, 0.34)
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false })
    this.planMaterials.push(mat)
    const mesh = new THREE.InstancedMesh(geo, mat, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    this.group.add(mesh)
    return mesh
  }

  update(sim: Simulation, time: number, dt: number): void {
    if (this.dirty) {
      this.dirty = false
      this.rebuild(sim)
    }
    this.syncPlans(sim, time)
    // Valves hiss now and then on live steam mains.
    const n = networkIndex(sim, 'steam')
    const steam = n >= 0 ? sim.energy.totals[n] : undefined
    const joints = this.nets[n]?.joints ?? []
    if (steam && steam.supply > 0 && joints.length) {
      this.hissAcc += dt * Math.min(3, joints.length * 0.08)
      while (this.hissAcc >= 1) {
        this.hissAcc -= 1
        const j = joints[Math.floor(Math.random() * joints.length)]
        this.particles.emit('steam', j.x, j.y + 0.1, j.z, 0.05)
      }
    }
  }

  private syncPlans(sim: Simulation, time: number): void {
    let key = `${sim.conduitJobs.size}`
    for (const [k, job] of sim.conduitJobs) key += `,${k}:${job.grade ?? ''}`
    for (const m of this.planMaterials) m.opacity = 0.45 + 0.3 * Math.sin(time * 3)
    if (key === this.planKey) return
    this.planKey = key
    if (sim.conduitJobs.size > this.plans.instanceMatrix.count) {
      this.group.remove(this.plans)
      this.plans.dispose()
      this.plans = this.makePlans(sim.conduitJobs.size * 2)
    }
    const world = sim.world
    let count = 0
    for (const job of sim.conduitJobs.values()) {
      const at = gradeIndex(sim, job.network, job.grade)
      if (!at) continue
      const net = sim.rules.networks[at.n]
      const style = (at.g === 0 ? net.conduit : net.upgrades![at.g - 1]).style
      const x = world.xOf(job.tile) + 0.5
      const y = world.yOf(job.tile) + 0.5
      this.matrix.makeTranslation(x, this.terrain.heightAt(x, y) + STYLE_Y[style], y)
      this.plans.setMatrixAt(count, this.matrix)
      this.plans.setColorAt(count, this.color.set(net.color))
      count++
    }
    this.plans.count = count
    this.plans.instanceMatrix.needsUpdate = true
    if (this.plans.instanceColor) this.plans.instanceColor.needsUpdate = true
  }

  private clear(): void {
    for (const net of this.nets) {
      for (const m of net.meshes) {
        this.group.remove(m)
        m.geometry.dispose()
      }
    }
    this.nets = []
  }

  private rebuild(sim: Simulation): void {
    this.clear()
    sim.rules.networks.forEach((net, n) => {
      this.nets[n] = this.buildNetwork(sim, n, net.id)
      for (const m of this.nets[n].meshes) this.group.add(m)
    })
  }

  /** Whether the tile next to (x, y) in direction d carries this network (a conduit, or a building on the grid). */
  private links(sim: Simulation, n: number, network: string, x: number, y: number): boolean[] {
    const world = sim.world
    return DIRS.map(([dx, dy]) => {
      const nx = x + dx
      const ny = y + dy
      if (!world.inBounds(nx, ny)) return false
      const j = world.index(nx, ny)
      if (world.conduit[j] & (1 << n)) return true
      const b = world.building[j] ? sim.buildings.get(world.building[j]) : undefined
      return !!b && participates(sim, b, network)
    })
  }

  private buildNetwork(sim: Simulation, n: number, network: string): NetworkMesh {
    const world = sim.world
    const buckets = new Buckets()
    const joints: THREE.Vector3[] = []
    for (let i = 0; i < world.size; i++) {
      if (!(world.conduit[i] & (1 << n))) continue
      const style = tileGrade(sim, n, i).style
      if (style === 'wire') this.wireTile(sim, n, network, i, buckets)
      else this.pipeTile(sim, n, network, i, style, buckets, joints)
    }
    const meshes: THREE.Mesh[] = []
    for (const [mat, geos] of buckets.parts) {
      const merged = mergeGeometries(
        geos.map((g) => {
          const flat = g.index ? g.toNonIndexed() : g
          flat.deleteAttribute('uv')
          return flat
        }),
      )
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, material(mat))
      mesh.castShadow = true
      mesh.receiveShadow = true
      meshes.push(mesh)
    }
    return { meshes, joints }
  }

  private pipeTile(sim: Simulation, n: number, network: string, i: number, style: ConduitStyle, b: Buckets, joints: THREE.Vector3[]): void {
    const world = sim.world
    const t = this.terrain
    const x = world.xOf(i)
    const y = world.yOf(i)
    const cx = x + 0.5
    const cy = y + 0.5
    const ground = t.heightAt(cx, cy)
    const lift = STYLE_Y[style]
    const r = STYLE_R[style]
    const pipeMat = STYLE_MAT[style]
    const centre = new THREE.Vector3(cx, ground + lift, cy)
    const links = this.links(sim, n, network, x, y)
    let count = 0
    links.forEach((on, d) => {
      if (!on) return
      count++
      const [dx, dy] = DIRS[d]
      const edgeGround = (ground + t.heightAt(cx + dx, cy + dy)) / 2
      const edge = new THREE.Vector3(cx + dx * 0.5, edgeGround + lift, cy + dy * 0.5)
      b.add(pipeMat, segment(centre, edge, r))
      // A lower grade on the other side: drop a riser at the tile edge.
      const j = world.index(x + dx, y + dy)
      if (world.conduit[j] & (1 << n)) {
        const other = STYLE_Y[tileGrade(sim, n, j).style]
        if (other < lift - 0.05) {
          b.add(pipeMat, segment(edge, new THREE.Vector3(edge.x, edgeGround + other, edge.z), r))
          b.add('brass', new THREE.SphereGeometry(r * 1.4, 8, 6).translate(edge.x, edgeGround + other, edge.z).toNonIndexed())
        }
      }
    })
    const straight = count === 2 && ((links[0] && links[2]) || (links[1] && links[3]))
    const along = links[0] || links[2] ? 'x' : 'z'
    const across = along === 'x' ? 'z' : 'x'
    if (count === 0) b.add(pipeMat, new THREE.SphereGeometry(r * 1.3, 8, 6).translate(centre.x, centre.y, centre.z).toNonIndexed())

    switch (style) {
      case 'duct': {
        // A timber trough under the clay pipe, with a stone cap at bends and junctions.
        if (straight) {
          const trough = new THREE.BoxGeometry(along === 'x' ? 1 : 0.26, 0.1, along === 'z' ? 1 : 0.26)
          b.add('plank', trough.translate(cx, ground + 0.05, cy).toNonIndexed())
          b.add('tile', band(centre, along, r * 1.25, 0.05))
        } else if (count > 0) {
          b.add('stone', new THREE.BoxGeometry(0.34, 0.24, 0.34).translate(cx, ground + 0.12, cy).toNonIndexed())
        }
        break
      }
      case 'water': {
        // Stone sleepers under the main, and a red hydrant on tees and crosses.
        if (straight && (x + y) % 2 === 0) {
          b.add('stone', new THREE.BoxGeometry(across === 'x' ? 0.3 : 0.1, 0.05, across === 'z' ? 0.3 : 0.1).translate(cx, ground + 0.025, cy).toNonIndexed())
        }
        if (straight) b.add('darkiron', band(centre, along, r * 1.4, 0.04))
        else if (count > 0) b.add('darkiron', new THREE.SphereGeometry(r * 1.6, 8, 6).translate(centre.x, centre.y, centre.z).toNonIndexed())
        if (count >= 3) {
          b.add('redpaint', new THREE.CylinderGeometry(0.07, 0.08, 0.36, 10).translate(cx + 0.18, ground + 0.18, cy + 0.18).toNonIndexed())
          b.add('redpaint', new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(cx + 0.18, ground + 0.36, cy + 0.18).toNonIndexed())
          b.add('brass', new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6).rotateZ(Math.PI / 2).translate(cx + 0.18, ground + 0.24, cy + 0.18).toNonIndexed())
        }
        break
      }
      case 'main':
      case 'lagged': {
        if (straight) {
          // Riveted flanges on iron mains; brass bands holding the sheathing on lagged ones.
          b.add('brass', band(centre, along, r * (style === 'lagged' ? 1.12 : 1.45), style === 'lagged' ? 0.05 : 0.06))
          if (style === 'lagged') {
            for (const s of [-0.3, 0.3]) {
              const p = centre.clone().add(new THREE.Vector3(along === 'x' ? s : 0, 0, along === 'z' ? s : 0))
              b.add('brass', band(p, along, r * 1.08, 0.03))
            }
          }
        } else if (count > 0) {
          // Elbows and junctions: a brass ball joint, and a valve wheel on tees and crosses.
          b.add('brass', new THREE.SphereGeometry(r * 1.55, 10, 8).translate(centre.x, centre.y, centre.z).toNonIndexed())
          if (count >= 3) {
            b.add('brass', new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6).translate(centre.x, centre.y + 0.14 + r, centre.z).toNonIndexed())
            b.add('brass', new THREE.TorusGeometry(0.1, 0.018, 5, 14).rotateX(Math.PI / 2).translate(centre.x, centre.y + 0.23 + r, centre.z).toNonIndexed())
            if (network === 'steam') joints.push(centre.clone())
          }
        }
        // Trestle: two legs and a saddle, except across roads where the main spans on its own.
        if (world.road[i] === 0) {
          for (const s of [-1, 1]) {
            const ox = across === 'x' ? s * 0.16 : 0
            const oz = across === 'z' ? s * 0.16 : 0
            const foot = new THREE.Vector3(cx + ox * 1.4, ground, cy + oz * 1.4)
            b.add('darkiron', segment(foot, new THREE.Vector3(cx + ox * 0.5, centre.y - r, cy + oz * 0.5), 0.022, 5))
          }
          const saddle = new THREE.BoxGeometry(across === 'x' ? 0.3 : 0.06, 0.035, across === 'z' ? 0.3 : 0.06)
          b.add('darkiron', saddle.translate(cx, centre.y - r - 0.01, cy).toNonIndexed())
        }
        break
      }
    }
  }

  private wireTile(sim: Simulation, n: number, network: string, i: number, b: Buckets): void {
    const world = sim.world
    const t = this.terrain
    const x = world.xOf(i)
    const y = world.yOf(i)
    const cx = x + 0.5
    const cy = y + 0.5
    const ground = t.heightAt(cx, cy)
    const lift = STYLE_Y.wire
    const links = this.links(sim, n, network, x, y)
    const count = links.filter(Boolean).length
    const straight = count === 2 && ((links[0] && links[2]) || (links[1] && links[3]))
    // Poles on every other tile of a straight run, and wherever the line turns, branches or ends.
    const pole = !straight || (x + y) % 2 === 0
    const alongX = links[0] || links[2]
    links.forEach((on, d) => {
      if (!on) return
      const [dx, dy] = DIRS[d]
      const edgeY = (ground + t.heightAt(cx + dx, cy + dy)) / 2 + lift
      for (const s of [-1, 1]) {
        // Two wires either side of the pole, sagging slightly towards the tile edge.
        const ox = dy !== 0 ? s * 0.13 : 0
        const oz = dx !== 0 ? s * 0.13 : 0
        b.add('copper', segment(new THREE.Vector3(cx + ox, ground + lift, cy + oz), new THREE.Vector3(cx + dx * 0.5 + ox, edgeY - 0.05, cy + dy * 0.5 + oz), STYLE_R.wire, 4))
      }
    })
    if (!pole) return
    b.add('timber', new THREE.CylinderGeometry(0.035, 0.045, lift + 0.12, 6).translate(cx, ground + (lift + 0.12) / 2, cy).toNonIndexed())
    const arm = new THREE.BoxGeometry(alongX ? 0.05 : 0.36, 0.04, alongX ? 0.36 : 0.05)
    b.add('timber', arm.translate(cx, ground + lift - 0.03, cy).toNonIndexed())
    for (const s of [-1, 1]) {
      const ox = alongX ? 0 : s * 0.13
      const oz = alongX ? s * 0.13 : 0
      b.add('glass', new THREE.CylinderGeometry(0.025, 0.03, 0.07, 6).translate(cx + ox, ground + lift + 0.02, cy + oz).toNonIndexed())
    }
  }

  dispose(): void {
    this.clear()
    this.plans.dispose()
    for (const m of this.planMaterials) m.dispose()
  }
}
