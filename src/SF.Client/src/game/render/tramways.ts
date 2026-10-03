import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Simulation } from '../sim/simulation'
import { material } from './materials'
import type { Particles } from './particles'
import type { TerrainLayer } from './terrain'

const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

interface Tram {
  group: THREE.Group
  from: number
  to: number
  t: number
}

function tramModel(): THREE.Group {
  const g = new THREE.Group()
  const part = (geo: THREE.BufferGeometry, mat: string) => {
    const m = new THREE.Mesh(geo, material(mat))
    m.castShadow = true
    g.add(m)
  }
  part(new THREE.BoxGeometry(0.85, 0.36, 0.42).translate(0, 0.3, 0), 'redpaint')
  part(new THREE.BoxGeometry(0.7, 0.12, 0.43).translate(0, 0.4, 0), 'glass')
  part(new THREE.BoxGeometry(0.92, 0.05, 0.48).translate(0, 0.5, 0), 'darkiron')
  part(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 8).translate(0.3, 0.63, 0), 'brass')
  part(mergeGeometries([-0.28, 0.28].flatMap((x) => [-0.17, 0.17].map((z) => new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10).rotateX(Math.PI / 2).translate(x, 0.1, z).toNonIndexed())))!, 'darkiron')
  return g
}

/**
 * Steam tramways: iron rails on sleepers along tramway road tiles, and little steam trams that run along them
 * while the colony's tram depot has steam. Purely visual; the simulation only changes the road speed.
 */
export class TramLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private readonly particles: Particles
  private rails: THREE.Mesh[] = []
  private trams: Tram[] = []
  private dirty = true
  private tiles: number[] = []
  private puffAcc = 0

  constructor(terrain: TerrainLayer, particles: Particles) {
    this.terrain = terrain
    this.particles = particles
  }

  markDirty(): void {
    this.dirty = true
  }

  private tramIndex(sim: Simulation): number {
    return sim.rules.roads.findIndex((r) => r.needsDepot) + 1
  }

  private isTram(sim: Simulation, i: number): boolean {
    return i >= 0 && i < sim.world.size && sim.world.road[i] === this.tramIndex(sim)
  }

  private rebuild(sim: Simulation): void {
    for (const m of this.rails) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.rails = []
    const world = sim.world
    const code = this.tramIndex(sim)
    this.tiles = []
    if (code === 0) return
    const iron: THREE.BufferGeometry[] = []
    const wood: THREE.BufferGeometry[] = []
    for (let i = 0; i < world.size; i++) {
      if (world.road[i] !== code) continue
      this.tiles.push(i)
      const x = world.xOf(i) + 0.5
      const z = world.yOf(i) + 0.5
      const y = this.terrain.heightAt(x, z) + 0.03
      const links = DIRS.map(([dx, dy]) => world.inBounds(world.xOf(i) + dx, world.yOf(i) + dy) && world.road[world.index(world.xOf(i) + dx, world.yOf(i) + dy)] === code)
      const along = (links[0] || links[2]) && !(links[1] || links[3]) ? 'x' : links[1] || links[3] ? 'z' : 'x'
      for (const [d, on] of links.entries()) {
        if (!on && links.some(Boolean)) continue
        const [dx, dy] = DIRS[d]
        const horizontal = dx !== 0
        if (!links.some(Boolean) && horizontal !== (along === 'x')) continue
        for (const s of [-0.18, 0.18]) {
          const rail = new THREE.BoxGeometry(horizontal ? 0.5 : 0.04, 0.04, horizontal ? 0.04 : 0.5)
          iron.push(rail.translate(x + dx * 0.25 + (horizontal ? 0 : s), y + 0.03, z + dy * 0.25 + (horizontal ? s : 0)).toNonIndexed())
        }
      }
      for (const k of [-0.25, 0.25]) {
        const sleeper = new THREE.BoxGeometry(along === 'x' ? 0.08 : 0.55, 0.03, along === 'x' ? 0.55 : 0.08)
        wood.push(sleeper.translate(x + (along === 'x' ? k : 0), y, z + (along === 'x' ? 0 : k)).toNonIndexed())
      }
    }
    for (const [mat, geos] of [['iron', iron], ['timber', wood]] as const) {
      if (!geos.length) continue
      const mesh = new THREE.Mesh(mergeGeometries(geos)!, material(mat))
      mesh.receiveShadow = true
      this.rails.push(mesh)
      this.group.add(mesh)
    }
  }

  update(sim: Simulation, dt: number): void {
    if (this.dirty) {
      this.dirty = false
      this.rebuild(sim)
    }
    const code = this.tramIndex(sim)
    const road = code > 0 ? sim.rules.roads[code - 1] : undefined
    const running = !!road && sim.world.roadSpeeds[code - 1] === road.speed
    // One tram per eight tiles of track while the depot has steam.
    const want = running ? Math.min(12, Math.floor(this.tiles.length / 8)) : 0
    while (this.trams.length > want) this.group.remove(this.trams.pop()!.group)
    while (this.trams.length < want && this.tiles.length) {
      const start = this.tiles[Math.floor(Math.random() * this.tiles.length)]
      const tram = { group: tramModel(), from: start, to: start, t: 1 }
      this.group.add(tram.group)
      this.trams.push(tram)
    }
    this.puffAcc += dt
    const puff = this.puffAcc > 0.35
    if (puff) this.puffAcc = 0
    const world = sim.world
    for (const tram of this.trams) {
      tram.t += dt * 2.2
      if (tram.t >= 1) {
        // Pick the next tile: straight on or a turn, back only at a dead end.
        const here = tram.to
        const options = DIRS.map(([dx, dy]) => world.index(world.xOf(here) + dx, world.yOf(here) + dy)).filter((j) => this.isTram(sim, j) && j !== tram.from)
        tram.from = here
        tram.to = options.length ? options[Math.floor(Math.random() * options.length)] : tram.from === here ? here : tram.from
        if (!options.length) {
          const back = DIRS.map(([dx, dy]) => world.index(world.xOf(here) + dx, world.yOf(here) + dy)).find((j) => this.isTram(sim, j))
          tram.to = back ?? here
        }
        tram.t = 0
      }
      const ax = world.xOf(tram.from) + 0.5
      const az = world.yOf(tram.from) + 0.5
      const bx = world.xOf(tram.to) + 0.5
      const bz = world.yOf(tram.to) + 0.5
      const x = ax + (bx - ax) * tram.t
      const z = az + (bz - az) * tram.t
      tram.group.position.set(x, this.terrain.heightAt(x, z) + 0.04, z)
      if (bx !== ax || bz !== az) tram.group.rotation.y = Math.atan2(-(bz - az), bx - ax)
      if (puff) this.particles.emit('steam', x, this.terrain.heightAt(x, z) + 0.8, z, 0.05)
    }
  }

  dispose(): void {
    for (const m of this.rails) m.geometry.dispose()
  }
}
