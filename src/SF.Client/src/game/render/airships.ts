import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { AirshipConfig, ShipPhase } from '../sim/components/airship'
import type { Simulation } from '../sim/simulation'
import { material } from './materials'
import type { Particles } from './particles'
import type { TerrainLayer } from './terrain'

interface Ship {
  group: THREE.Group
  props: THREE.Object3D[]
  stack: THREE.Vector3
}

/** A riveted dirigible: canvas envelope with brass bands and fins, a timber gondola, twin propellers. */
function buildShip(scale: number): Ship {
  const group = new THREE.Group()
  const len = 7 * scale
  const r = 1.0 * scale
  const merge = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!
  const add = (geo: THREE.BufferGeometry, mat: string) => {
    const mesh = new THREE.Mesh(geo, material(mat))
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }
  // Envelope along +x (the nose).
  add(new THREE.SphereGeometry(1, 24, 14).scale(len / 2, r, r), 'envelope')
  add(merge([-0.3, 0, 0.3].map((k) => new THREE.TorusGeometry(r * Math.sqrt(1 - k * k * 4 * 0.9) * 1.01, 0.05 * scale, 6, 24).rotateY(Math.PI / 2).translate((k * len) / 1.1, 0, 0))), 'brass')
  add(new THREE.SphereGeometry(0.22 * scale, 10, 8).translate(len / 2 - 0.05 * scale, 0, 0), 'brass')
  // Tail fins.
  const fin = new THREE.BoxGeometry(1.1 * scale, 0.05 * scale, 0.9 * scale)
  add(merge([
    fin.clone().translate(-len / 2 + 0.6 * scale, 0, 0.75 * scale),
    fin.clone().translate(-len / 2 + 0.6 * scale, 0, -0.75 * scale),
    fin.clone().rotateX(Math.PI / 2).translate(-len / 2 + 0.6 * scale, 0.75 * scale, 0),
  ]), 'redpaint')
  // Gondola on struts.
  add(new THREE.BoxGeometry(2.2 * scale, 0.5 * scale, 0.6 * scale).translate(0, -r - 0.55 * scale, 0), 'timber')
  add(new THREE.BoxGeometry(2.3 * scale, 0.06 * scale, 0.66 * scale).translate(0, -r - 0.28 * scale, 0), 'brass')
  add(new THREE.BoxGeometry(1.6 * scale, 0.14 * scale, 0.62 * scale).translate(0, -r - 0.5 * scale, 0), 'glass')
  add(merge([-0.8, 0.8].map((x) => new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 0.4 * scale, 5).translate(x * scale, -r - 0.15 * scale, 0))), 'darkiron')
  // Propellers either side of the gondola stern.
  const props: THREE.Object3D[] = []
  for (const side of [-1, 1]) {
    const hub = new THREE.Group()
    hub.position.set(-1.25 * scale, -r - 0.5 * scale, side * 0.5 * scale)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04 * scale, 0.7 * scale, 0.1 * scale), material('brass'))
    const blade2 = blade.clone()
    blade2.rotation.x = Math.PI / 2
    hub.add(blade, blade2)
    group.add(hub)
    props.push(hub)
  }
  return { group, props, stack: new THREE.Vector3(-0.6 * scale, -r - 0.3 * scale, 0) }
}

interface MastView {
  ship: Ship
  phase: ShipPhase
  /** Seconds (real) since the phase began, for smooth motion between simulation seconds. */
  t: number
}

interface Drifter {
  ship: Ship
  x: number
  z: number
  y: number
  heading: number
  speed: number
}

/**
 * Airships in the sky: the Company airship that calls at each airship mast (approaching, moored at the mooring
 * cone, casting off) and a few cosmetic dirigibles drifting over the valley. Purely visual.
 */
export class AirshipLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private readonly particles: Particles
  private readonly masts = new Map<number, MastView>()
  private readonly drifters: Drifter[] = []
  private width = 0
  private height = 0
  private smokeAcc = 0

  constructor(terrain: TerrainLayer, particles: Particles, width: number, height: number) {
    this.terrain = terrain
    this.particles = particles
    this.width = width
    this.height = height
    for (let i = 0; i < 3; i++) {
      const ship = buildShip(0.8 + Math.random() * 0.5)
      this.group.add(ship.group)
      this.drifters.push({ ship, x: Math.random() * width, z: Math.random() * height, y: 22 + Math.random() * 10, heading: Math.random() * Math.PI * 2, speed: 0.8 + Math.random() * 0.6 })
    }
  }

  update(sim: Simulation, dt: number, time: number): void {
    for (const d of this.drifters) {
      d.heading += Math.sin(time * 0.05 + d.y) * 0.002
      d.x += Math.cos(d.heading) * d.speed * dt
      d.z -= Math.sin(d.heading) * d.speed * dt
      // Wrap around the map with a margin so ships slip in and out of view.
      const m = 30
      if (d.x < -m) d.x += this.width + 2 * m
      if (d.x > this.width + m) d.x -= this.width + 2 * m
      if (d.z < -m) d.z += this.height + 2 * m
      if (d.z > this.height + m) d.z -= this.height + 2 * m
      d.ship.group.position.set(d.x, d.y + Math.sin(time * 0.4 + d.x) * 0.3, d.z)
      d.ship.group.rotation.y = d.heading
      for (const p of d.ship.props) p.rotation.z += dt * 9
    }
    this.syncMasts(sim, dt, time)
  }

  private syncMasts(sim: Simulation, dt: number, time: number): void {
    for (const [id, view] of this.masts) {
      if (!sim.buildings.has(id) || sim.buildings.get(id)!.site) {
        this.group.remove(view.ship.group)
        this.masts.delete(id)
      }
    }
    this.smokeAcc += dt
    const puff = this.smokeAcc > 0.25
    if (puff) this.smokeAcc = 0
    for (const b of sim.buildings.values()) {
      const cfg = sim.component<AirshipConfig>(b, 'airship')
      if (!cfg || b.site) continue
      let view = this.masts.get(b.id)
      if (!view) {
        const ship = buildShip(1.25)
        this.group.add(ship.group)
        view = { ship, phase: 'away', t: 0 }
        this.masts.set(b.id, view)
      }
      const phase = b.data.ship as ShipPhase
      if (phase !== view.phase) {
        view.phase = phase
        view.t = Math.max(0, (b.data.shipT as number) ?? 0)
      }
      view.t += dt
      const ship = view.ship
      ship.group.visible = phase !== 'away'
      if (phase === 'away') continue
      // The mooring cone sits on the mast's tower; the nose docks against it.
      const cone = new THREE.Vector3(b.x + b.w / 2 + 0.35, this.terrain.heightAt(b.x + b.w / 2, b.y + b.h / 2) + 6.4, b.y + b.h / 2 - 0.35)
      const heading = Math.PI * 0.15 + b.id
      const back = new THREE.Vector3(-Math.cos(heading), 0, Math.sin(heading))
      const moored = cone.clone().addScaledVector(back, 3.5 * 1.25 + 0.3).add(new THREE.Vector3(0, 0.4, 0))
      const far = moored.clone().addScaledVector(back, 70).add(new THREE.Vector3(0, 14, 0))
      const k = Math.min(1, view.t / cfg.approachSeconds)
      const ease = k * k * (3 - 2 * k)
      const pos = phase === 'moored' ? moored : phase === 'arriving' ? far.clone().lerp(moored, ease) : moored.clone().lerp(far, ease * ease)
      ship.group.position.copy(pos)
      ship.group.position.y += Math.sin(time * 0.7 + b.id) * (phase === 'moored' ? 0.08 : 0.25)
      ship.group.rotation.y = heading
      for (const p of ship.props) p.rotation.z += dt * (phase === 'moored' ? 2 : 14)
      if (puff) {
        const s = ship.stack.clone().applyEuler(ship.group.rotation).add(ship.group.position)
        this.particles.emit('steam', s.x, s.y, s.z, 0.1)
      }
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  }
}
