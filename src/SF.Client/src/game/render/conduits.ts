import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { participates } from '../sim/energy'
import type { Simulation } from '../sim/simulation'
import { material } from './materials'
import type { Particles } from './particles'
import type { TerrainLayer } from './terrain'

/** Height of steam mains above the ground (citizens walk underneath), and of power lines. */
const PIPE_Y = 0.62
const PIPE_R = 0.075
const WIRE_Y = 1.42

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

/** One network's built conduits, merged per material. */
interface NetworkMesh {
  meshes: THREE.Mesh[]
  /** Junction positions, for the occasional hiss of steam from a valve. */
  joints: THREE.Vector3[]
}

/**
 * Draws laid conduits from World.conduit: copper steam mains on iron trestles (with brass flanges and valve wheels
 * at junctions) and copper power lines strung between insulated poles. Pipes reach into the buildings they serve.
 * Planned conduits show as pulsing markers. Rebuilt only when a 'conduit' or building event marks it dirty.
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
    const steam = sim.energy.totals[0]
    const joints = this.nets[0]?.joints ?? []
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
    for (const k of sim.conduitJobs.keys()) key += `,${k}`
    for (const m of this.planMaterials) m.opacity = 0.45 + 0.3 * Math.sin(time * 3)
    if (key === this.planKey) return
    this.planKey = key
    if (sim.conduitJobs.size > this.plans.instanceMatrix.count) {
      this.group.remove(this.plans)
      this.plans.dispose()
      this.plans = this.makePlans(sim.conduitJobs.size * 2)
    }
    const world = sim.world
    let n = 0
    for (const job of sim.conduitJobs.values()) {
      const net = sim.rules.networks.findIndex((x) => x.id === job.network)
      const x = world.xOf(job.tile) + 0.5
      const y = world.yOf(job.tile) + 0.5
      this.matrix.makeTranslation(x, this.terrain.heightAt(x, y) + (net === 0 ? PIPE_Y : WIRE_Y), y)
      this.plans.setMatrixAt(n, this.matrix)
      this.plans.setColorAt(n, this.color.set(sim.rules.networks[net]?.color ?? '#ffffff'))
      n++
    }
    this.plans.count = n
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
      this.nets[n] = n === 0 ? this.buildPipes(sim, n, net.id) : this.buildWires(sim, n, net.id)
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

  private buildPipes(sim: Simulation, n: number, network: string): NetworkMesh {
    const world = sim.world
    const t = this.terrain
    const pipe: THREE.BufferGeometry[] = []
    const brass: THREE.BufferGeometry[] = []
    const iron: THREE.BufferGeometry[] = []
    const joints: THREE.Vector3[] = []
    for (let i = 0; i < world.size; i++) {
      if (!(world.conduit[i] & (1 << n))) continue
      const x = world.xOf(i)
      const y = world.yOf(i)
      const cx = x + 0.5
      const cy = y + 0.5
      const ground = t.heightAt(cx, cy)
      const centre = new THREE.Vector3(cx, ground + PIPE_Y, cy)
      const links = this.links(sim, n, network, x, y)
      let count = 0
      links.forEach((on, d) => {
        if (!on) return
        count++
        const [dx, dy] = DIRS[d]
        const ex = cx + dx * 0.5
        const ey = cy + dy * 0.5
        const edgeY = (ground + t.heightAt(cx + dx, cy + dy)) / 2 + PIPE_Y
        pipe.push(segment(centre, new THREE.Vector3(ex, edgeY, ey), PIPE_R))
      })
      const straight = count === 2 && ((links[0] && links[2]) || (links[1] && links[3]))
      if (count === 0) pipe.push(new THREE.SphereGeometry(PIPE_R * 1.3, 8, 6).translate(centre.x, centre.y, centre.z).toNonIndexed())
      if (straight) {
        // A riveted flange where two sections meet.
        const along = links[0] ? 'x' : 'z'
        const flange = new THREE.CylinderGeometry(PIPE_R * 1.45, PIPE_R * 1.45, 0.06, 10)
        flange.rotateZ(along === 'x' ? Math.PI / 2 : 0).rotateX(along === 'z' ? Math.PI / 2 : 0)
        brass.push(flange.translate(centre.x, centre.y, centre.z).toNonIndexed())
      } else if (count > 0) {
        // Elbows and junctions: a brass ball joint, and a valve wheel on tees and crosses.
        brass.push(new THREE.SphereGeometry(PIPE_R * 1.55, 10, 8).translate(centre.x, centre.y, centre.z).toNonIndexed())
        if (count >= 3) {
          brass.push(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6).translate(centre.x, centre.y + 0.14, centre.z).toNonIndexed())
          brass.push(new THREE.TorusGeometry(0.1, 0.018, 5, 14).rotateX(Math.PI / 2).translate(centre.x, centre.y + 0.23, centre.z).toNonIndexed())
          joints.push(centre.clone())
        }
      }
      // Trestle: two legs and a saddle, except across roads where the main spans on its own.
      if (world.road[i] === 0) {
        const across = links[0] || links[2] ? 'z' : 'x'
        for (const s of [-1, 1]) {
          const ox = across === 'x' ? s * 0.16 : 0
          const oz = across === 'z' ? s * 0.16 : 0
          const foot = new THREE.Vector3(cx + ox * 1.4, ground, cy + oz * 1.4)
          iron.push(segment(foot, new THREE.Vector3(cx + ox * 0.5, centre.y - PIPE_R, cy + oz * 0.5), 0.022, 5))
        }
        const saddle = new THREE.BoxGeometry(across === 'x' ? 0.3 : 0.06, 0.035, across === 'z' ? 0.3 : 0.06)
        iron.push(saddle.translate(cx, centre.y - PIPE_R - 0.01, cy).toNonIndexed())
      }
    }
    return { meshes: this.meshes([['copper', pipe], ['brass', brass], ['darkiron', iron]]), joints }
  }

  private buildWires(sim: Simulation, n: number, network: string): NetworkMesh {
    const world = sim.world
    const t = this.terrain
    const wire: THREE.BufferGeometry[] = []
    const wood: THREE.BufferGeometry[] = []
    const glass: THREE.BufferGeometry[] = []
    for (let i = 0; i < world.size; i++) {
      if (!(world.conduit[i] & (1 << n))) continue
      const x = world.xOf(i)
      const y = world.yOf(i)
      const cx = x + 0.5
      const cy = y + 0.5
      const ground = t.heightAt(cx, cy)
      const links = this.links(sim, n, network, x, y)
      const count = links.filter(Boolean).length
      const straight = count === 2 && ((links[0] && links[2]) || (links[1] && links[3]))
      // Poles on every other tile of a straight run, and wherever the line turns, branches or ends.
      const pole = !straight || (x + y) % 2 === 0
      const alongX = links[0] || links[2]
      links.forEach((on, d) => {
        if (!on) return
        const [dx, dy] = DIRS[d]
        const edgeY = (ground + t.heightAt(cx + dx, cy + dy)) / 2 + WIRE_Y
        for (const s of [-1, 1]) {
          // Two wires either side of the pole, sagging slightly towards the tile edge.
          const ox = dy !== 0 ? s * 0.13 : 0
          const oz = dx !== 0 ? s * 0.13 : 0
          wire.push(segment(new THREE.Vector3(cx + ox, ground + WIRE_Y, cy + oz), new THREE.Vector3(cx + dx * 0.5 + ox, edgeY - 0.05, cy + dy * 0.5 + oz), 0.012, 4))
        }
      })
      if (!pole) continue
      wood.push(new THREE.CylinderGeometry(0.035, 0.045, WIRE_Y + 0.12, 6).translate(cx, ground + (WIRE_Y + 0.12) / 2, cy).toNonIndexed())
      const arm = new THREE.BoxGeometry(alongX ? 0.05 : 0.36, 0.04, alongX ? 0.36 : 0.05)
      wood.push(arm.translate(cx, ground + WIRE_Y - 0.03, cy).toNonIndexed())
      for (const s of [-1, 1]) {
        const ox = alongX ? 0 : s * 0.13
        const oz = alongX ? s * 0.13 : 0
        glass.push(new THREE.CylinderGeometry(0.025, 0.03, 0.07, 6).translate(cx + ox, ground + WIRE_Y + 0.02, cy + oz).toNonIndexed())
      }
    }
    return { meshes: this.meshes([['copper', wire], ['timber', wood], ['glass', glass]]), joints: [] }
  }

  private meshes(parts: [string, THREE.BufferGeometry[]][]): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    for (const [mat, geos] of parts) {
      if (geos.length === 0) continue
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
        g.deleteAttribute('uv')
        return g
      }))
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, material(mat))
      mesh.castShadow = true
      mesh.receiveShadow = true
      out.push(mesh)
    }
    return out
  }

  dispose(): void {
    this.clear()
    this.plans.dispose()
    for (const m of this.planMaterials) m.dispose()
  }
}
