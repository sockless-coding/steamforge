import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Simulation } from '../sim/simulation'
import type { SimEvent } from '../sim/types'
import { BuildingLayer } from './buildings'
import { CameraRig } from './camera'
import { CitizenLayer } from './citizens'
import { ConduitLayer } from './conduits'
import { NatureLayer } from './nature'
import { OverlayLayer } from './overlays'
import { setBuildingEnvironment } from './materials'
import { Particles } from './particles'
import type { QualityProfile } from './quality'
import { TerrainLayer } from './terrain'

interface SeasonLook {
  sky: string
  sun: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  tint: [number, number, number]
  snow: number
}

const LOOKS: Record<string, SeasonLook> = {
  spring: { sky: '#a8c8d8', sun: '#fff1d8', sunIntensity: 2.6, hemiSky: '#cfe2ef', hemiGround: '#4a5a32', tint: [1.04, 1.1, 0.95], snow: 0 },
  summer: { sky: '#9ec4dc', sun: '#fff0d0', sunIntensity: 3, hemiSky: '#d4e6f2', hemiGround: '#4f5a30', tint: [1, 1, 1], snow: 0 },
  autumn: { sky: '#c4b8a0', sun: '#ffd8a8', sunIntensity: 2.4, hemiSky: '#e0d0b8', hemiGround: '#5a4a2a', tint: [1.12, 0.98, 0.74], snow: 0 },
  winter: { sky: '#b4c0ca', sun: '#e6eeff', sunIntensity: 1.9, hemiSky: '#d8e2ec', hemiGround: '#5a5e66', tint: [0.94, 0.96, 1.02], snow: 0.92 },
}

const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.75, 0.35).normalize()

/**
 * Three.js view of the colony. Reads the simulation each frame and never mutates it. Owned by the GameController,
 * which forwards input and simulation events.
 */
export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly rig: CameraRig
  readonly terrain: TerrainLayer
  readonly nature: NatureLayer
  readonly buildings: BuildingLayer
  readonly citizens: CitizenLayer
  readonly conduits: ConduitLayer
  readonly overlays: OverlayLayer
  readonly particles: Particles
  private readonly parent: HTMLElement
  private readonly sun: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly environment: THREE.Texture
  private composer: EffectComposer | null = null
  private quality: QualityProfile
  private time = 0
  private snow = 0
  private readonly tint = new THREE.Color(1, 1, 1)
  private readonly skyColor = new THREE.Color()
  private snowAcc = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly resizeObserver: ResizeObserver

  constructor(parent: HTMLElement, sim: Simulation, quality: QualityProfile) {
    this.parent = parent
    this.quality = quality
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.className = 'world-canvas'
    parent.appendChild(this.renderer.domElement)

    const world = sim.world
    this.rig = new CameraRig(1)
    this.rig.setBounds(world.width, world.height)

    this.hemi = new THREE.HemisphereLight('#d4e6f2', '#4f5a30', 1.1)
    this.sun = new THREE.DirectionalLight('#fff0d0', 3)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    this.scene.add(this.hemi, this.sun, this.sun.target)
    this.scene.fog = new THREE.Fog('#9ec4dc', 80, 260)
    // A soft studio environment gives brass, copper and glass something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    setBuildingEnvironment(this.environment)
    pmrem.dispose()

    this.terrain = new TerrainLayer(world)
    this.rig.heightAt = (x, z) => this.terrain.heightAt(x, z)
    this.particles = new Particles(quality.particles)
    this.nature = new NatureLayer(world, this.terrain, sim.content.bundle.features)
    this.buildings = new BuildingLayer(this.terrain, this.particles)
    this.citizens = new CitizenLayer(this.terrain, sim.content.bundle.professions, sim.content.bundle.resources)
    this.overlays = new OverlayLayer(this.terrain)
    this.conduits = new ConduitLayer(this.terrain, this.particles)
    this.scene.add(this.terrain.group, this.nature.group, this.buildings.group, this.conduits.group, this.citizens.group, this.overlays.group, this.particles.points)

    this.applyQuality()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(parent)
    this.resize()
  }

  setQuality(quality: QualityProfile): void {
    this.quality = quality
    this.applyQuality()
    this.resize()
  }

  private applyQuality(): void {
    const q = this.quality
    this.renderer.setPixelRatio(q.resolution)
    this.renderer.shadowMap.enabled = q.shadows > 0
    this.sun.castShadow = q.shadows > 0
    if (q.shadows > 0) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.composer?.dispose()
    this.composer = null
    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera))
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.88))
      this.composer.addPass(new OutputPass())
    }
  }

  resize(): void {
    const w = Math.max(1, this.parent.clientWidth)
    const h = Math.max(1, this.parent.clientHeight)
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.composer?.setPixelRatio(this.quality.resolution)
    this.rig.camera.aspect = w / h
    this.rig.camera.updateProjectionMatrix()
    this.particles.setViewportHeight(h * this.quality.resolution)
  }

  handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'feature':
          this.nature.markDirty()
          break
        case 'road':
          this.terrain.repaint(e.tile)
          break
        case 'terrain':
          this.terrain.reshape(e.x, e.y, e.w, e.h)
          this.nature.markDirty()
          this.conduits.markDirty()
          break
        case 'conduit':
          this.conduits.markDirty()
          break
        case 'building':
          // Pipes reach into the buildings they serve, so finished or removed buildings reshape the mains.
          if (e.change !== 'changed') this.conduits.markDirty()
          break
      }
    }
  }

  frame(sim: Simulation, dt: number, alpha: number): void {
    this.time += dt
    this.rig.update(dt)

    const look = LOOKS[sim.season.id] ?? LOOKS.summer
    // Snow arrives with the frost and melts in spring; everything eases between seasons.
    const snowGoal = sim.temperature < 1 ? look.snow || 0.6 : 0
    this.snow += (snowGoal - this.snow) * Math.min(1, dt * 0.25)
    this.tint.lerp(new THREE.Color(...look.tint), Math.min(1, dt * 0.5))
    this.skyColor.lerp(new THREE.Color(look.sky), Math.min(1, dt * 0.5))
    this.terrain.setSeason(this.snow, this.tint)
    this.nature.setSeason(this.snow > 0.4 ? 'winter' : sim.season.id === 'winter' ? 'autumn' : sim.season.id)
    this.scene.background = this.skyColor
    const fog = this.scene.fog as THREE.Fog
    fog.color.copy(this.skyColor)
    fog.near = this.rig.distance * 1.6
    fog.far = this.rig.distance * 5 + 120
    this.sun.color.lerp(new THREE.Color(look.sun), Math.min(1, dt))
    this.sun.intensity += (look.sunIntensity - this.sun.intensity) * Math.min(1, dt)
    this.hemi.color.set(look.hemiSky)
    this.hemi.groundColor.set(look.hemiGround)

    // The sun's shadow frustum follows the camera target and grows with zoom.
    const target = this.rig.target
    this.sun.position.copy(target).addScaledVector(SUN_DIRECTION, 120)
    this.sun.target.position.copy(target)
    const extent = THREE.MathUtils.clamp(this.rig.distance * 0.95, 18, 110)
    const cam = this.sun.shadow.camera
    if (cam.right !== extent) {
      cam.left = cam.bottom = -extent
      cam.right = cam.top = extent
      cam.near = 10
      cam.far = 260
      cam.updateProjectionMatrix()
    }

    if (this.snow > 0.3) {
      this.snowAcc += dt * 40 * this.snow
      while (this.snowAcc >= 1) {
        this.snowAcc -= 1
        const r = this.rig.distance
        this.particles.emit('snow', target.x + (Math.random() - 0.5) * r * 1.6, target.y + 8 + Math.random() * 10, target.z + (Math.random() - 0.5) * r * 1.6, 0)
      }
    }

    this.terrain.update(this.time)
    this.nature.update(performance.now())
    this.buildings.sync(sim, this.time, dt)
    this.conduits.update(sim, this.time, dt)
    this.citizens.update(sim, alpha, this.time)
    this.particles.update(dt)

    if (this.composer) this.composer.render(dt)
    else this.renderer.render(this.scene, this.rig.camera)
  }

  /** Ground point under a screen position (ray-marched against the heightfield), in tile space. */
  pickGround(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.rig.camera)
    const { origin, direction } = this.raycaster.ray
    const p = new THREE.Vector3()
    let prev = 0
    const step = 0.4
    for (let t = 0; t < 900; t += step) {
      p.copy(origin).addScaledVector(direction, t)
      if (p.y <= this.terrain.heightAt(p.x, p.z)) {
        // Refine between the last two samples.
        let lo = prev
        let hi = t
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2
          p.copy(origin).addScaledVector(direction, mid)
          if (p.y <= this.terrain.heightAt(p.x, p.z)) hi = mid
          else lo = mid
        }
        p.copy(origin).addScaledVector(direction, hi)
        return { x: p.x, y: p.z }
      }
      prev = t
    }
    return null
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.composer?.dispose()
    this.terrain.dispose()
    this.nature.dispose()
    this.buildings.dispose()
    this.citizens.dispose()
    this.overlays.dispose()
    this.conduits.dispose()
    this.particles.dispose()
    setBuildingEnvironment(null)
    this.environment.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
