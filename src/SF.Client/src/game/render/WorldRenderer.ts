import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Simulation } from '../sim/simulation'
import type { SimEvent } from '../sim/types'
import { AirshipLayer } from './airships'
import { BuildingLayer } from './buildings'
import { CameraRig } from './camera'
import { CitizenLayer } from './citizens'
import { ConduitLayer } from './conduits'
import { NatureLayer } from './nature'
import { OverlayLayer } from './overlays'
import { material, setBuildingEnvironment, setBuildingEnvironmentIntensity } from './materials'
import { Particles } from './particles'
import type { QualityProfile } from './quality'
import { GradeShader } from './grade'
import { TerrainLayer } from './terrain'
import { TramLayer } from './tramways'

interface SeasonLook {
  sky: string
  sun: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  tint: [number, number, number]
  snow: number
}

// Pale, cold northern skies over the untouched frontier; the colony's smoke turns them brass (see SMOG).
const LOOKS: Record<string, SeasonLook> = {
  spring: { sky: '#aebcc4', sun: '#fff0dc', sunIntensity: 2.6, hemiSky: '#cbd8df', hemiGround: '#4a5034', tint: [1.0, 1.05, 0.97], snow: 0 },
  summer: { sky: '#a9b8bf', sun: '#fff0d4', sunIntensity: 2.9, hemiSky: '#d0dce2', hemiGround: '#4c5232', tint: [1, 1, 1], snow: 0 },
  autumn: { sky: '#b9b2a4', sun: '#ffd6a6', sunIntensity: 2.3, hemiSky: '#d8ccb8', hemiGround: '#54462c', tint: [1.1, 0.97, 0.78], snow: 0 },
  winter: { sky: '#b2b9bf', sun: '#e8eefc', sunIntensity: 1.9, hemiSky: '#d6dee6', hemiGround: '#575a60', tint: [0.94, 0.96, 1.02], snow: 0.92 },
}

const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.75, 0.35).normalize()

const NIGHT_SKY = new THREE.Color('#121a2e')
const DUSK_SKY = new THREE.Color('#d0784a')
const MOONLIGHT = new THREE.Color('#8ea8e0')
const NIGHT_HEMI = new THREE.Color('#33405e')
/** Coal-smoke haze: thick industry turns the sky brass. */
const SMOG = new THREE.Color('#b0884e')
/** Night smog glows with the furnaces below it. */
const NIGHT_SMOG = new THREE.Color('#3a2414')

/** 0 in daylight, 1 at full night, with dusk and dawn in between. `sun` is the simulation's sun height (-1..1). */
function nightFactor(sun: number): number {
  return THREE.MathUtils.clamp((0.18 - sun) / 0.45, 0, 1)
}

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
  readonly airships: AirshipLayer
  readonly trams: TramLayer
  readonly overlays: OverlayLayer
  readonly particles: Particles
  private readonly parent: HTMLElement
  private readonly sun: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly environment: THREE.Texture
  private composer: EffectComposer | null = null
  private grade: ShaderPass | null = null
  private grimeTimer = 0
  private sootView = false
  private readonly grimeLevels: Float32Array[] = []
  private quality: QualityProfile
  private time = 0
  private snow = 0
  private readonly tint = new THREE.Color(1, 1, 1)
  private readonly skyColor = new THREE.Color()
  private snowAcc = 0
  private dayNight = true
  private night = 0
  private smog = 0
  private smogTimer = 0
  private readonly displaySky = new THREE.Color()
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
    this.airships = new AirshipLayer(this.terrain, this.particles, world.width, world.height)
    this.trams = new TramLayer(this.terrain, this.particles)
    this.scene.add(
      this.terrain.group,
      this.nature.group,
      this.buildings.group,
      this.conduits.group,
      this.trams.group,
      this.airships.group,
      this.citizens.group,
      this.overlays.group,
      this.particles.points,
    )

    this.applyQuality()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(parent)
    this.resize()
  }

  /** Shows airborne soot as a heat map over the ground. */
  setSootView(on: boolean): void {
    if (on === this.sootView) return
    this.sootView = on
    this.terrain.setSootView(on)
    this.grimeTimer = 0
  }

  /** Shows or hides the dark of night (off holds a bright afternoon; night still passes in the simulation). */
  setDayNight(enabled: boolean): void {
    this.dayNight = enabled
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
    this.grade = null
    // Every tier but the lowest renders through a composer for the amber-and-teal grade (and bloom on high tiers);
    // the lowest falls back to a CSS filter on the canvas.
    if (q.tier !== 'low') {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.antialias ? 4 : 0 })
      this.composer = new EffectComposer(this.renderer, target)
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera))
      if (q.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.88))
      this.composer.addPass(new OutputPass())
      this.grade = new ShaderPass(GradeShader)
      this.composer.addPass(this.grade)
    }
    this.renderer.domElement.classList.toggle('graded', this.grade !== null)
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
          this.trams.markDirty()
          break
        case 'terrain':
          this.terrain.reshape(e.x, e.y, e.w, e.h)
          this.nature.markDirty()
          this.conduits.markDirty()
          break
        case 'conduit':
          this.conduits.markDirty()
          break
        case 'expedition':
          this.airships.expedition(e.forge, e.change === 'departed')
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
    // Day and night, dusk glow, and coal-smoke haze that thickens as the colony's industry works.
    const nightGoal = this.dayNight ? nightFactor(sim.sun) * 0.88 : 0
    this.night += (nightGoal - this.night) * Math.min(1, dt * 2)
    this.smogTimer -= dt
    if (this.smogTimer <= 0) {
      this.smogTimer = 1
      this.smog += (this.smogGoal(sim) - this.smog) * 0.2
    }
    const dusk = 4 * this.night * (1 - this.night)
    this.displaySky
      .copy(this.skyColor)
      .lerp(SMOG, this.smog * 0.65)
      .lerp(DUSK_SKY, dusk * 0.35)
      .lerp(NIGHT_SKY, this.night)
      .lerp(NIGHT_SMOG, this.night * this.smog * 0.5)
    this.scene.background = this.displaySky
    const fog = this.scene.fog as THREE.Fog
    fog.color.copy(this.displaySky)
    fog.near = this.rig.distance * (1.6 - 0.6 * this.smog)
    fog.far = this.rig.distance * (5 - 2 * this.smog) + 120 * (1 - 0.4 * this.smog)
    this.sun.color.lerp(new THREE.Color(look.sun).lerp(DUSK_SKY, dusk * 0.5).lerp(MOONLIGHT, this.night), Math.min(1, dt * 2))
    const sunGoal = look.sunIntensity * (1 - 0.82 * this.night) * (1 - 0.15 * this.smog)
    this.sun.intensity += (sunGoal - this.sun.intensity) * Math.min(1, dt * 2)
    this.hemi.color.set(look.hemiSky).lerp(NIGHT_HEMI, this.night)
    this.hemi.groundColor.set(look.hemiGround).lerp(NIGHT_HEMI, this.night * 0.7)
    this.hemi.intensity = 1.1 * (1 - 0.55 * this.night)
    // Windows and gas lamps glow brighter as the light goes.
    material('glass').emissiveIntensity = 0.35 + 1.5 * this.night
    material('lamp').emissiveIntensity = 0.7 + 1.9 * this.night
    this.buildings.setNight(this.night)
    if (this.grade) {
      const u = this.grade.uniforms
      u.uAmount.value = 0.75 + 0.35 * this.smog
      u.uSmog.value = this.smog
      u.uNight.value = this.night
    }
    // Plumes lean with the simulation's wind (a little exaggerated so it reads from the camera).
    this.particles.wind.set(sim.weather.windX * 1.4, sim.weather.windY * 1.4)
    this.grimeTimer -= dt
    if (this.grimeTimer <= 0) {
      this.grimeTimer = 1
      this.uploadGrime(sim)
    }
    setBuildingEnvironmentIntensity(0.55 * (1 - 0.8 * this.night))

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
    this.trams.update(sim, dt)
    this.airships.update(sim, dt, this.time)
    this.citizens.update(sim, alpha, this.time)
    this.particles.update(dt)

    if (this.composer) this.composer.render(dt)
    else this.renderer.render(this.scene, this.rig.camera)
  }

  /**
   * 0 for a clean sky, 1 for a town under a pall of coal smoke: the soot in the air around the camera, and a share
   * of the worst anywhere in the colony (a smoking town browns the whole valley's sky).
   */
  private smogGoal(sim: Simulation): number {
    const f = sim.soot
    const full = sim.rules.soot.fullSoot
    const t = this.rig.target
    const cx = Math.floor(t.x / f.cell)
    const cy = Math.floor(t.z / f.cell)
    let local = 0
    let n = 0
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || y < 0 || x >= f.cols || y >= f.rows) continue
        local += f.soot[y * f.cols + x]
        n++
      }
    }
    let peak = 0
    for (let i = 0; i < f.soot.length; i++) peak = Math.max(peak, f.soot[i])
    return THREE.MathUtils.clamp(Math.max((n ? local / n : 0) / full, (peak / full) * 0.45), 0, 1)
  }

  /**
   * Shows settled grime on the ground, smoothed over a few seconds so the ground darkens gradually. The ground shows
   * fully blackened at half the grime that fully fouls the soil, so a town's soot is visible well before it ruins
   * its crops.
   */
  private uploadGrime(sim: Simulation): void {
    const f = sim.soot
    const full = sim.rules.soot.fullGrime * 0.5
    let shown = this.grimeLevels[0]
    if (!shown || shown.length !== f.grime.length) {
      shown = new Float32Array(f.grime.length)
      for (let i = 0; i < shown.length; i++) shown[i] = f.grime[i] / full
      this.grimeLevels[0] = shown
    }
    for (let i = 0; i < shown.length; i++) shown[i] += (f.grime[i] / full - shown[i]) * 0.3
    this.terrain.setGrime(shown, f.cols, f.rows, f.cell)
    if (this.sootView) {
      const full = sim.rules.soot.fullSoot
      const exposure = new Float32Array(f.soot.length)
      for (let i = 0; i < exposure.length; i++) exposure[i] = f.soot[i] / full
      this.terrain.setSoot(exposure, f.cols, f.rows, sim.rules.soot.lungSafe)
    }
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
    this.trams.dispose()
    this.airships.dispose()
    this.particles.dispose()
    setBuildingEnvironment(null)
    this.environment.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
