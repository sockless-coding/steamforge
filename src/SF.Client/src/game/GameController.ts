import type { Content } from '../api/content'
import { reportColony } from '../api/saves'
import type { BuildingDef } from '../api/types'
import { AUTOSAVE_ID, encodeSnapshot, writeLocalSave, type SaveMeta } from '../lib/saves'
import { useAuth } from '../state/auth'
import {
  initialHud,
  useHud,
  type BuildingInfo,
  type CitizenInfo,
  type HudState,
  type NetworkRow,
  type OptionInfo,
  type ProfessionRow,
  type ResearchRow,
  type Tool,
} from '../state/game'
import type { Settings } from '../state/settings'
import { Ambience } from './audio/ambience'
import { MusicDirector } from './audio/music'
import { play } from './audio/synth'
import type { FieldConfig } from './sim/components/field'
import { currentRecipe, type ProducerConfig } from './sim/components/producer'
import { conduitGrades, gradeIndex, networkIndex, participates, touchesGrid, type ConsumerConfig, type GeneratorConfig } from './sim/energy'
import { canPlace, doorTile, footprintSize, totalWork } from './sim/placement'
import { canResearch, currentResearch, isUnlocked, lockedBy, unlockNames } from './sim/research'
import { Simulation, type ColonySnapshot } from './sim/simulation'
import { sootExposure, windFrom, windVector } from './sim/soot'
import type { Action, ActionResult, Building, Citizen, NewColonyOptions, Rotation, SimEvent } from './sim/types'
import type { TileMark } from './render/overlays'
import { FrameGovernor, lowerTier, resolveQuality, type QualityProfile } from './render/quality'
import { WorldRenderer } from './render/WorldRenderer'

export type GameStart = { mode: 'new'; options: NewColonyOptions } | { mode: 'load'; snapshot: ColonySnapshot }

export interface GameControllerOptions {
  parent: HTMLElement
  content: Content
  settings: Settings
  start: GameStart
  /** Escape with nothing else to cancel: the UI opens its menu. */
  onMenu?: () => void
}

const SPEEDS = [1, 2, 5, 10, 20]

/** "HH:MM" for a fraction of a day (0 = midnight), to the quarter hour. */
function clockTime(dayProgress: number): string {
  const quarters = Math.floor(dayProgress * 96) % 96
  return `${String(Math.floor(quarters / 4)).padStart(2, '0')}:${String((quarters % 4) * 15).padStart(2, '0')}`
}
const HUD_INTERVAL = 0.15
const AUTOSAVE_SECONDS = 180
const MAX_STEPS_PER_FRAME = 60

interface Drag {
  pointerId: number
  button: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  startTile: [number, number] | null
  moved: boolean
}

/**
 * Runs a colony: fixed-step simulation at the chosen speed (pause freezes time but every command still works,
 * Banished-style), interpolated rendering, mouse/touch/keyboard tools, HUD publishing and local autosave.
 */
export class GameController {
  readonly sim: Simulation
  readonly renderer: WorldRenderer
  private readonly options: GameControllerOptions
  private readonly content: Content
  private quality: QualityProfile
  private readonly governor = new FrameGovernor()
  private readonly ambience = new Ambience()
  private raf = 0
  private last = 0
  private acc = 0
  private paused = false
  private speedIndex = 0
  private tool: Tool = { kind: 'select' }
  private rot: Rotation = 0
  private hover: [number, number] | null = null
  private hint: string | null = null
  private drag: Drag | null = null
  private touches = new Map<number, { x: number; y: number }>()
  private pinch = { distance: 0, angle: 0 }
  private selected: { kind: 'building' | 'citizen'; id: number } | null = null
  private hudTimer = 0
  private autosaveTimer = 0
  private lastYear: number
  private saveStatus: HudState['save'] = 'idle'
  private sootView = false
  private destroyed = false
  private readonly cleanup: (() => void)[] = []

  constructor(options: GameControllerOptions) {
    this.options = options
    this.content = options.content
    this.sim = options.start.mode === 'new' ? Simulation.create(options.content, options.start.options) : Simulation.deserialize(options.content, options.start.snapshot)
    this.lastYear = this.sim.year
    this.quality = resolveQuality(options.settings.quality)
    this.renderer = new WorldRenderer(options.parent, this.sim, this.quality)
    this.renderer.rig.edgeScroll = options.settings.edgeScroll
    this.renderer.setDayNight(options.settings.dayNight)
    const hall = [...this.sim.buildings.values()].find((b) => this.sim.def(b).components.shelter)
    if (hall) this.renderer.rig.jumpTo(hall.x + hall.w / 2, hall.y + hall.h / 2 + 4, 34)

    this.bindInput()
    useHud.setState({ ...initialHud, ready: true })
    this.publish()
    MusicDirector.get().setMode('menu')
    this.updateAmbience()
    if (options.start.mode === 'new') this.report(true)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  // ---------------------------------------------------------------- loop

  private frame = (now: number) => {
    if (this.destroyed) return
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const sim = this.sim
    if (!this.paused && sim.outcome === 'playing') {
      this.acc += dt * SPEEDS[this.speedIndex]
      let steps = 0
      while (this.acc >= sim.dt && steps < MAX_STEPS_PER_FRAME) {
        sim.step()
        this.acc -= sim.dt
        steps++
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0
      this.handleEvents(sim.drainEvents())
      this.autosaveTimer += dt
      if (this.autosaveTimer >= AUTOSAVE_SECONDS) void this.autosave()
    } else {
      // Commands issued while paused still emit events (placements, roads, marks).
      this.handleEvents(sim.drainEvents())
    }
    this.renderer.setSootView(this.sootView || this.placingSmoke())
    this.renderer.frame(sim, dt, this.paused ? 1 : Math.min(1, this.acc / sim.dt))

    if (this.governor.sample(dt) && this.options.settings.quality === 'auto') {
      const lower = lowerTier(this.quality.tier)
      if (lower) {
        this.quality = resolveQuality(lower)
        this.renderer.setQuality(this.quality)
      }
    }

    this.hudTimer += dt
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0
      this.publish()
    }
    this.raf = requestAnimationFrame(this.frame)
  }

  private handleEvents(events: SimEvent[]): void {
    if (events.length === 0) return
    this.renderer.handleEvents(events)
    for (const e of events) {
      switch (e.type) {
        case 'building':
          if (e.change === 'completed') play('build', { volume: 0.5, cooldown: 0.2 })
          break
        case 'notice':
          if (e.notice.level === 'bad') play('alarm', { volume: 0.35, cooldown: 2 })
          else if (e.notice.level === 'good') play('coin', { bus: 'ui', volume: 0.4, cooldown: 1 })
          break
        case 'fire':
          if (e.active) play('flame', { volume: 0.6, cooldown: 1 })
          break
        case 'month':
          this.updateAmbience()
          if (this.sim.year !== this.lastYear) {
            this.lastYear = this.sim.year
            this.report(false)
          }
          break
        case 'outcome':
          play('defeat', { volume: 0.7 })
          this.report(false)
          break
      }
    }
  }

  private updateAmbience(): void {
    let industry = false
    for (const b of this.sim.buildings.values()) {
      if (!b.site && (this.sim.def(b).components.boiler || this.sim.def(b).components.producer)) industry = true
    }
    this.ambience.start({ water: true, industry, winter: this.sim.season.id === 'winter' })
  }

  private report(founded: boolean): void {
    if (!useAuth.getState().session) return
    const sim = this.sim
    void reportColony(sim.options.difficulty, founded, sim.year - 1, sim.stats.peakPopulation).catch(() => undefined)
  }

  // ---------------------------------------------------------------- commands (UI)

  perform(action: Action): ActionResult {
    const result = this.sim.perform(action)
    if (!result.ok) play('click', { bus: 'ui', volume: 0.3 })
    this.handleEvents(this.sim.drainEvents())
    this.publish()
    return result
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    play('click', { bus: 'ui', volume: 0.5 })
    if (paused) void this.autosave()
    this.publish()
  }

  togglePause(): void {
    this.setPaused(!this.paused)
  }

  setSpeed(index: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index))
    this.paused = false
    this.publish()
  }

  setTool(tool: Tool): void {
    this.tool = tool
    this.hint = null
    this.renderer.overlays.clear()
    if (tool.kind !== 'select') this.select(null)
    this.updatePreview()
    this.publish()
  }

  select(target: { kind: 'building' | 'citizen'; id: number } | null): void {
    this.selected = target
    this.renderer.buildings.selected = target?.kind === 'building' ? target.id : 0
    this.publish()
  }

  focusTile(tile: number): void {
    const w = this.sim.world
    this.renderer.rig.focus(w.xOf(tile) + 0.5, w.yOf(tile) + 0.5)
  }

  focusBuilding(id: number): void {
    const b = this.sim.buildings.get(id)
    if (!b) return
    this.renderer.rig.focus(b.x + b.w / 2, b.y + b.h / 2)
    this.select({ kind: 'building', id })
  }

  focusCitizen(id: number): void {
    const c = this.sim.citizens.get(id)
    if (!c) return
    const home = c.inside ? this.sim.buildings.get(c.inside) : undefined
    this.renderer.rig.focus(home ? home.x + home.w / 2 : c.x, home ? home.y + home.h / 2 : c.y)
    this.select({ kind: 'citizen', id })
  }

  /** Spreads a profession's worker target across its workplaces (professions panel). */
  setProfessionTarget(profession: string, target: number): void {
    let left = Math.max(0, Math.round(target))
    for (const b of this.sim.buildings.values()) {
      if (b.site || this.sim.component<{ profession: string }>(b, 'workplace')?.profession !== profession) continue
      const n = Math.min(left, this.sim.maxWorkers(b))
      this.sim.perform({ type: 'setWorkers', building: b.id, count: n })
      left -= n
    }
    this.publish()
  }

  snapshot(): ColonySnapshot {
    return this.sim.serialize()
  }

  saveMeta(): SaveMeta {
    const sim = this.sim
    return {
      name: sim.options.name,
      summary: `Year ${sim.year}, ${sim.rules.months[sim.month]} · ${sim.citizens.size} citizens`,
      difficulty: sim.options.difficulty,
      year: sim.year,
      population: sim.citizens.size,
      contentVersion: this.content.bundle.version,
      saveVersion: this.snapshot().v,
    }
  }

  async encode(): Promise<string> {
    return encodeSnapshot(this.snapshot())
  }

  async autosave(): Promise<void> {
    this.autosaveTimer = 0
    if (this.sim.outcome !== 'playing') return
    this.saveStatus = 'saving'
    try {
      await writeLocalSave(AUTOSAVE_ID, this.saveMeta(), await this.encode())
      this.saveStatus = 'saved'
    } catch {
      this.saveStatus = 'error'
    }
    if (!this.destroyed) this.publish()
  }

  /** Shows or hides the soot heat map. */
  toggleSootView(): void {
    this.sootView = !this.sootView
    this.publish()
  }

  /** Placing a chimney, a home or something that cleans the air shows the soot map automatically. */
  private placingSmoke(): boolean {
    if (this.tool.kind !== 'build') return false
    const c = this.sim.def(this.tool.def).components
    return !!(c.emitter || c.housing || c.scrubber || c.clinic)
  }

  private airInfo(): HudState['air'] {
    const sim = this.sim
    let sum = 0
    let worst = 0
    let homes = 0
    for (const b of sim.buildings.values()) {
      if (b.site || b.residents.length === 0 || !sim.def(b).components.housing) continue
      const e = sootExposure(sim, b.x + b.w / 2, b.y + b.h / 2)
      sum += e
      worst = Math.max(worst, e)
      homes++
    }
    return {
      homes: homes ? sum / homes : 0,
      worst,
      safe: sim.rules.soot.lungSafe,
      windFrom: windFrom(sim),
      windSpeed: windVector(sim).speed,
      view: this.sootView,
    }
  }

  setQualitySettings(settings: Settings): void {
    this.quality = resolveQuality(settings.quality)
    this.renderer.setQuality(this.quality)
    this.renderer.rig.edgeScroll = settings.edgeScroll
    this.renderer.setDayNight(settings.dayNight)
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const canvas = this.renderer.renderer.domElement
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts))
    }
    canvas.style.touchAction = 'none'
    on(canvas, 'contextmenu', (e) => e.preventDefault())
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e))
    on(canvas, 'pointermove', (e) => this.onPointerMove(e))
    on(canvas, 'pointerup', (e) => this.onPointerUp(e))
    on(canvas, 'pointercancel', (e) => this.onPointerUp(e))
    on(canvas, 'pointerleave', () => {
      this.renderer.rig.setEdge(0, 0)
      if (!this.drag) this.hover = null
    })
    on(canvas, 'wheel', (e) => {
      e.preventDefault()
      this.renderer.rig.zoom(e.deltaY)
    }, { passive: false })
    on(window, 'keydown', (e) => this.onKey(e, true))
    on(window, 'keyup', (e) => this.onKey(e, false))
    on(window, 'blur', () => this.renderer.rig.clearKeys())
    const onVisibility = () => {
      if (document.hidden && !this.paused) this.setPaused(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility))
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
    const rig = this.renderer.rig
    if (!down) {
      rig.keyUp(e.code)
      return
    }
    if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) return
    switch (e.code) {
      case 'Space':
        e.preventDefault()
        this.togglePause()
        return
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
        this.setSpeed(Number(e.code.slice(5)) - 1)
        return
      case 'KeyR':
        this.rot = ((this.rot + (e.shiftKey ? 3 : 1)) % 4) as Rotation
        this.updatePreview()
        return
      case 'Escape':
        // An open panel closes itself on Escape; don't also cancel tools or open the menu behind it.
        if (document.querySelector('.modal-scrim')) return
        if (this.drag) this.drag = null
        else if (this.tool.kind !== 'select') this.setTool({ kind: 'select' })
        else if (this.selected) this.select(null)
        else this.options.onMenu?.()
        return
      case 'Delete':
        if (this.selected?.kind === 'building') this.demolishSelected()
        return
      case 'Home': {
        const hall = [...this.sim.buildings.values()].find((b) => this.sim.def(b).components.shelter)
        if (hall) rig.focus(hall.x + hall.w / 2, hall.y + hall.h / 2)
        return
      }
    }
    rig.keyDown(e.code)
  }

  demolishSelected(): void {
    if (this.selected?.kind !== 'building') return
    const b = this.sim.buildings.get(this.selected.id)
    if (!b) return
    const result = this.perform(b.site ? { type: 'cancelSite', building: b.id } : { type: 'demolish', building: b.id })
    if (result.ok) this.select(null)
  }

  private tileAt(clientX: number, clientY: number): [number, number] | null {
    const p = this.renderer.pickGround(clientX, clientY)
    if (!p) return null
    const w = this.sim.world
    const x = Math.floor(p.x)
    const y = Math.floor(p.y)
    return w.inBounds(x, y) ? [x, y] : null
  }

  private onPointerDown(e: PointerEvent): void {
    const canvas = this.renderer.renderer.domElement
    canvas.setPointerCapture(e.pointerId)
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size === 2) {
        this.drag = null
        this.pinch = this.pinchState()
        return
      }
    }
    this.drag = { pointerId: e.pointerId, button: e.button, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, startTile: this.tileAt(e.clientX, e.clientY), moved: false }
  }

  private pinchState(): { distance: number; angle: number } {
    const [a, b] = [...this.touches.values()]
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) }
  }

  /** Tools that use a left-button drag (area or path) rather than a click. */
  private dragTool(): boolean {
    const t = this.tool
    if (t.kind === 'build') return !!this.sim.def(t.def).placement?.variableSize
    return t.kind === 'road' || t.kind === 'removeRoad' || t.kind === 'clear' || t.kind === 'unclear' || t.kind === 'conduit' || t.kind === 'removeConduit'
  }

  private onPointerMove(e: PointerEvent): void {
    const rig = this.renderer.rig
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size === 2) {
        const now = this.pinchState()
        if (this.pinch.distance > 0) rig.zoomBy(this.pinch.distance / Math.max(1, now.distance))
        rig.rotateBy(-(now.angle - this.pinch.angle))
        this.pinch = now
        return
      }
    }
    if (e.pointerType === 'mouse') {
      const rect = this.renderer.renderer.domElement.getBoundingClientRect()
      const edge = 12
      rig.setEdge(e.clientX - rect.left < edge ? -1 : rect.right - e.clientX < edge ? 1 : 0, e.clientY - rect.top < edge ? -1 : rect.bottom - e.clientY < edge ? 1 : 0)
    }

    const drag = this.drag
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) drag.moved = true
      const height = this.renderer.renderer.domElement.clientHeight
      if (drag.button === 1) rig.rotate(dx, dy)
      else if (drag.button === 2 || (drag.button === 0 && drag.moved && !this.dragTool() && this.tool.kind !== 'build')) rig.pan(dx, dy, height)
      else if (drag.button === 0 && e.pointerType === 'touch' && this.tool.kind === 'build' && !this.dragTool() && drag.moved) rig.pan(dx, dy, height)
    }
    this.hover = this.tileAt(e.clientX, e.clientY)
    this.updatePreview()
  }

  private onPointerUp(e: PointerEvent): void {
    this.touches.delete(e.pointerId)
    const drag = this.drag
    if (!drag || drag.pointerId !== e.pointerId) return
    this.drag = null
    const tile = this.tileAt(e.clientX, e.clientY) ?? this.hover
    if (drag.button === 2) {
      if (!drag.moved) {
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' })
        else this.select(null)
      }
      return
    }
    if (drag.button !== 0) return

    const t = this.tool
    if (this.dragTool() && drag.startTile && tile) {
      this.commitDrag(drag.startTile, tile)
    } else if (!drag.moved && tile) {
      if (t.kind === 'build') this.placeAt(tile, e.shiftKey)
      else if (t.kind === 'demolish') {
        const id = this.sim.world.building[this.sim.world.index(tile[0], tile[1])]
        if (id) {
          this.select({ kind: 'building', id })
          this.demolishSelected()
        }
      } else if (t.kind === 'select') this.pick(e.clientX, e.clientY, tile)
    }
    this.updatePreview()
  }

  private pick(clientX: number, clientY: number, tile: [number, number]): void {
    const p = this.renderer.pickGround(clientX, clientY)
    const citizen = p ? this.renderer.citizens.pick(this.sim, p.x, p.y) : 0
    if (citizen) {
      this.select({ kind: 'citizen', id: citizen })
      play('click', { bus: 'ui', volume: 0.4 })
      return
    }
    const id = this.sim.world.building[this.sim.world.index(tile[0], tile[1])]
    this.select(id ? { kind: 'building', id } : null)
    if (id) play('click', { bus: 'ui', volume: 0.4 })
  }

  private footprintAt(def: BuildingDef, tile: [number, number]): { x: number; y: number; w: number; h: number } {
    const [w, h] = footprintSize(def, this.rot)
    return { x: tile[0] - Math.floor((w - 1) / 2), y: tile[1] - Math.floor((h - 1) / 2), w, h }
  }

  private placeAt(tile: [number, number], keepTool: boolean): void {
    if (this.tool.kind !== 'build') return
    const def = this.sim.def(this.tool.def)
    const f = this.footprintAt(def, tile)
    const result = this.perform({ type: 'place', def: def.id, x: f.x, y: f.y, rot: this.rot })
    if (result.ok) {
      play('hammer', { volume: 0.45 })
      if (def.limit === 1 && !keepTool) this.setTool({ kind: 'select' })
    } else this.hint = result.reason
  }

  private rect(a: [number, number], b: [number, number]): { x: number; y: number; w: number; h: number } {
    const x = Math.min(a[0], b[0])
    const y = Math.min(a[1], b[1])
    return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 }
  }

  /** Road path: along x first, then along y (an L), like dragging a road in Banished. */
  private roadPath(a: [number, number], b: [number, number]): number[] {
    const w = this.sim.world
    const tiles: number[] = []
    const sx = Math.sign(b[0] - a[0])
    const sy = Math.sign(b[1] - a[1])
    for (let x = a[0]; ; x += sx) {
      tiles.push(w.index(x, a[1]))
      if (x === b[0] || sx === 0) break
    }
    for (let y = a[1] + sy; sy !== 0; y += sy) {
      tiles.push(w.index(b[0], y))
      if (y === b[1]) break
    }
    return tiles
  }

  private areaTiles(a: [number, number], b: [number, number], cap = 900): number[] {
    const r = this.rect(a, b)
    const out: number[] = []
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w && out.length < cap; x++) out.push(this.sim.world.index(x, y))
    return out
  }

  private commitDrag(a: [number, number], b: [number, number]): void {
    const t = this.tool
    if (t.kind === 'road') {
      if (this.perform({ type: 'road', road: t.road, tiles: this.roadPath(a, b) }).ok) play('hammer', { volume: 0.3 })
    } else if (t.kind === 'conduit') {
      const result = this.perform({ type: 'conduit', network: t.network, grade: t.grade, tiles: this.roadPath(a, b) })
      if (result.ok) play('hammer', { volume: 0.3 })
      else this.hint = result.reason
    } else if (t.kind === 'removeConduit') {
      this.perform({ type: 'removeConduit', network: t.network, tiles: this.areaTiles(a, b) })
    } else if (t.kind === 'removeRoad') {
      this.perform({ type: 'removeRoad', tiles: this.areaTiles(a, b) })
    } else if (t.kind === 'clear' || t.kind === 'unclear') {
      this.perform({ type: 'markClear', tiles: this.areaTiles(a, b), clear: t.kind === 'clear' })
    } else if (t.kind === 'build') {
      const def = this.sim.def(t.def)
      const min = def.placement?.variableSize?.min ?? [3, 3]
      let r = this.rect(a, b)
      if (r.w === 1 && r.h === 1) r = { x: a[0] - 2, y: a[1] - 2, w: def.size[0], h: def.size[1] }
      const result = this.perform({ type: 'place', def: def.id, x: r.x, y: r.y, rot: 0, w: Math.max(min[0], r.w), h: Math.max(min[1], r.h) })
      if (result.ok) play('hammer', { volume: 0.45 })
      else this.hint = result.reason
    }
  }

  private updatePreview(): void {
    const overlays = this.renderer.overlays
    const t = this.tool
    const sim = this.sim
    const tile = this.hover
    overlays.clear()
    if (!tile) return
    const dragging = this.drag?.button === 0 && this.drag.startTile ? this.drag.startTile : null

    if (t.kind === 'build') {
      const def = sim.def(t.def)
      if (def.placement?.variableSize) {
        const r = dragging ? this.rect(dragging, tile) : { x: tile[0] - 2, y: tile[1] - 2, w: def.size[0], h: def.size[1] }
        const min = def.placement.variableSize.min
        const w = Math.max(min[0], r.w)
        const h = Math.max(min[1], r.h)
        const check = canPlace(sim, def, r.x, r.y, 0, w, h)
        this.hint = check.ok ? `${w} × ${h} field` : check.reason
        const marks: TileMark[] = []
        for (let y = r.y; y < r.y + h; y++) for (let x = r.x; x < r.x + w; x++) marks.push({ x, y, ok: check.ok })
        overlays.setTiles(marks)
        return
      }
      const f = this.footprintAt(def, tile)
      const check = canPlace(sim, def, f.x, f.y, this.rot)
      this.hint = check.ok ? `${this.gridHint(def, f)}R to rotate the entrance` : `${check.reason} · R to rotate`
      overlays.setGhost(def, f.x, f.y, f.w, f.h, this.rot, check.ok)
      if (!def.walkable) {
        const door = doorTile(sim.world, def, f.x, f.y, f.w, f.h, this.rot)
        overlays.setDoor(sim.world.xOf(door), sim.world.yOf(door), f.x + f.w / 2, f.y + f.h / 2)
      }
      const marks: TileMark[] = []
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) marks.push({ x, y, ok: check.ok })
      const network = this.energyNetworkOf(def)
      overlays.setTiles(network ? [...this.gridMarks(network), ...marks] : marks)
      const radius =
        sim.component<{ radius?: number }>(def.id, 'gatherer')?.radius ??
        sim.component<{ radius: number }>(def.id, 'boiler')?.radius ??
        sim.component<{ radius: number }>(def.id, 'firefighting')?.radius ??
        sim.component<{ radius: number }>(def.id, 'lighting')?.radius ??
        sim.component<{ radius: number }>(def.id, 'amenity')?.radius ??
        sim.component<{ radius: number }>(def.id, 'scrubber')?.radius ??
        sim.component<{ radius: number }>(def.id, 'clinic')?.radius ??
        0
      overlays.setRing(f.x + f.w / 2, f.y + f.h / 2, radius)
      return
    }
    if (t.kind === 'road') {
      const tiles = dragging ? this.roadPath(dragging, tile) : [sim.world.index(tile[0], tile[1])]
      const w = sim.world
      overlays.setTiles(tiles.map((i) => ({ x: w.xOf(i), y: w.yOf(i), ok: w.isLand(i) && w.building[i] === 0 })))
      const road = sim.rules.roads.find((r) => r.id === t.road)
      const stone = road?.cost.stone ? ` · ${tiles.length * road.cost.stone} stone` : ''
      this.hint = `${tiles.length} tiles${stone}`
      return
    }
    if (t.kind === 'conduit') {
      const tiles = dragging ? this.roadPath(dragging, tile) : [sim.world.index(tile[0], tile[1])]
      const w = sim.world
      const at = gradeIndex(sim, t.network, t.grade)
      const grade = at ? conduitGrades(sim.rules.networks[at.n])[at.g] : null
      const marks = tiles.map((i) => ({ x: w.xOf(i), y: w.yOf(i), ok: w.isLand(i) && w.building[i] === 0 }))
      overlays.setTiles([...this.gridMarks(t.network), ...marks])
      const cost = Object.entries(grade?.cost ?? {}).map(([r, q]) => `${q * tiles.length} ${sim.resource(r)?.name.toLowerCase() ?? r}`)
      const lock = lockedBy(sim, 'network', t.network) ?? (t.grade && at && at.g > 0 ? lockedBy(sim, 'conduit', t.grade) : null)
      const loss = grade ? ` · loses ${Math.round(grade.lossPerTile * 1000) / 10}% pressure per tile` : ''
      this.hint = lock ? `Requires research: ${lock.name}` : `${tiles.length} tiles${cost.length ? ` · ${cost.join(', ')}` : ''}${loss} · runs over roads`
      return
    }
    if (t.kind === 'removeConduit') {
      const area = dragging ? this.areaTiles(dragging, tile) : [sim.world.index(tile[0], tile[1])]
      const w = sim.world
      const n = sim.rules.networks.findIndex((x) => x.id === t.network)
      const relevant = area.filter((i) => w.conduit[i] & (1 << n) || sim.conduitJobs.has(i * 8 + n))
      overlays.setTiles(area.map((i) => ({ x: w.xOf(i), y: w.yOf(i), ok: false })))
      this.hint = `${relevant.length} ${sim.rules.networks[n]?.conduit.name.toLowerCase() ?? 'conduit'} tiles`
      return
    }
    if (t.kind === 'removeRoad' || t.kind === 'clear' || t.kind === 'unclear') {
      const area = dragging ? this.areaTiles(dragging, tile) : [sim.world.index(tile[0], tile[1])]
      const w = sim.world
      const relevant = area.filter((i) => (t.kind === 'removeRoad' ? w.road[i] !== 0 || sim.roadJobs.has(i) : w.feature[i] !== 0))
      overlays.setTiles(area.map((i) => ({ x: w.xOf(i), y: w.yOf(i), ok: t.kind !== 'removeRoad' })), t.kind === 'clear')
      this.hint = t.kind === 'removeRoad' ? `${relevant.length} road tiles` : `${relevant.length} trees, rocks and bushes`
      return
    }
    if (t.kind === 'demolish') {
      const id = sim.world.building[sim.world.index(tile[0], tile[1])]
      const b = sim.buildings.get(id)
      if (b) {
        const marks: TileMark[] = []
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) marks.push({ x, y, ok: false })
        overlays.setTiles(marks)
        this.hint = `${b.site ? 'Cancel' : 'Demolish'} ${sim.def(b).name}`
      } else this.hint = null
    }
  }

  /** The network a building generates or (first) consumes, if any. */
  private energyNetworkOf(def: BuildingDef): string | null {
    const gen = def.components.generator as GeneratorConfig | undefined
    if (gen) return gen.network
    const consumer = def.components.consumer as ConsumerConfig | undefined
    return consumer ? (Object.keys(consumer.uses)[0] ?? null) : null
  }

  /** Placement hint: whether the footprint joins a grid on the network the building needs. */
  private gridHint(def: BuildingDef, f: { x: number; y: number; w: number; h: number }): string {
    const network = this.energyNetworkOf(def)
    if (!network) return ''
    const net = this.sim.rules.networks.find((n) => n.id === network)
    const name = net?.name.toLowerCase() ?? network
    if (touchesGrid(this.sim, f.x, f.y, f.w, f.h, network)) return `Joins the ${name} grid · `
    const consumer = def.components.consumer as ConsumerConfig | undefined
    return consumer?.required ? `Not on a ${name} grid yet: connect it with ${net?.conduit.name.toLowerCase() ?? 'conduits'} · ` : `Can join a ${name} grid · `
  }

  /**
   * Every building and conduit tile on a network, shaded by the pressure reaching it: green at full head, amber at
   * half, red where none arrives. Generators show green while lit.
   */
  private gridMarks(network: string): TileMark[] {
    const sim = this.sim
    const marks: TileMark[] = []
    const n = networkIndex(sim, network)
    const heads = sim.energy.tileHeads[n]
    for (const b of sim.buildings.values()) {
      if (!participates(sim, b, network)) continue
      const gen = sim.component<GeneratorConfig>(b, 'generator')
      const head = gen?.network === network ? (b.data.lit === true ? 1 : 0) : ((b.data.power as number | undefined) ?? 0)
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) marks.push({ x, y, ok: head >= 0.99, head })
    }
    const w = sim.world
    for (let i = 0; i < w.size; i++) {
      if (!(w.conduit[i] & (1 << n))) continue
      marks.push({ x: w.xOf(i), y: w.yOf(i), ok: true, head: heads?.[i] ?? 0 })
    }
    return marks
  }

  // ---------------------------------------------------------------- HUD

  private publish(): void {
    const sim = this.sim
    const resources = sim.content.bundle.resources.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      color: r.color,
      amount: sim.totals[r.id] ?? 0,
      limit: sim.limits[r.id] ?? null,
      value: r.value ?? 0,
    }))
    const food = resources.filter((r) => r.category === 'food').reduce((s, r) => s + r.amount, 0)
    let builders = 0
    let laborers = 0
    for (const c of sim.citizens.values()) {
      if (c.profession === 'builder') builders++
      else if (c.profession === 'laborer') laborers++
    }
    let sites = 0
    for (const b of sim.buildings.values()) if (b.site) sites++

    useHud.setState({
      ready: true,
      colonyName: sim.options.name,
      difficulty: sim.preset.name,
      paused: this.paused,
      speed: this.speedIndex,
      speeds: SPEEDS,
      year: sim.year,
      month: sim.month,
      monthName: sim.rules.months[sim.month],
      season: sim.season.name,
      monthProgress: sim.monthProgress,
      timeOfDay: clockTime(sim.dayProgress),
      night: sim.isNight,
      petition: sim.petition
        ? {
            adults: sim.petition.adults,
            children: sim.petition.children,
            families: sim.petition.households.length,
            feverish: sim.petition.feverish,
            patience: (sim.petition.expires - sim.tick) / Math.max(1, sim.petition.expires - sim.petition.arrived),
          }
        : null,
      temperature: sim.temperature,
      population: sim.population(),
      peakPopulation: sim.stats.peakPopulation,
      resources,
      food,
      tool: this.tool,
      hint: this.hint,
      selection: this.selectionInfo(),
      notices: sim.notices.slice(-30),
      outcome: sim.outcome,
      builders: { target: sim.builderTarget, count: builders },
      laborers,
      professions: this.professionRows(),
      sites,
      save: this.saveStatus,
      research: this.researchRows(),
      researching: this.researching(),
      networks: this.networkRows(),
      dispatches: sim.story.sent,
      locks: this.locks(),
      credit: sim.credit,
      trade: { ...sim.trade },
      hasMast: [...sim.buildings.values()].some((b) => !b.site && !!sim.def(b).components.airship),
      air: this.airInfo(),
    })
  }

  private researchRows(): ResearchRow[] {
    const sim = this.sim
    const r = sim.research
    return sim.content.bundle.research.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tier: t.tier,
      points: t.points,
      progress: r.done.includes(t.id) ? t.points : (r.progress[t.id] ?? 0),
      requires: t.requires,
      unlocks: unlockNames(sim, t),
      status: r.done.includes(t.id) ? 'done' : r.queue[0] === t.id ? 'current' : r.queue.includes(t.id) ? 'queued' : canResearch(sim, t) ? 'available' : 'locked',
    }))
  }

  private researching(): HudState['researching'] {
    const tech = currentResearch(this.sim)
    return tech ? { name: tech.name, progress: this.sim.research.progress[tech.id] ?? 0, points: tech.points } : null
  }

  private networkRows(): NetworkRow[] {
    const sim = this.sim
    return sim.rules.networks.map((net, n) => {
      let active = false
      for (const b of sim.buildings.values()) {
        if (!b.site && participates(sim, b, net.id)) {
          active = true
          break
        }
      }
      const totals = sim.energy.totals[n] ?? { supply: 0, demand: 0 }
      return { id: net.id, name: net.name, unit: net.unit, color: net.color, supply: totals.supply, demand: totals.demand, active }
    })
  }

  /** Research gates for build bar entries, keyed like the research lock map. */
  private locks(): Record<string, string> {
    const sim = this.sim
    const out: Record<string, string> = {}
    for (const def of sim.content.bundle.buildings) {
      const lock = lockedBy(sim, 'building', def.id)
      if (lock) out[`building:${def.id}`] = lock.name
    }
    for (const road of sim.rules.roads) {
      const lock = lockedBy(sim, 'road', road.id)
      if (lock) out[`road:${road.id}`] = lock.name
    }
    for (const net of sim.rules.networks) {
      const lock = lockedBy(sim, 'network', net.id)
      if (lock) out[`network:${net.id}`] = lock.name
      for (const grade of net.upgrades ?? []) {
        const gradeLock = lock ?? lockedBy(sim, 'conduit', grade.id)
        if (gradeLock) out[`conduit:${grade.id}`] = gradeLock.name
      }
    }
    return out
  }

  private professionRows(): ProfessionRow[] {
    const sim = this.sim
    const rows = new Map<string, ProfessionRow>()
    for (const b of sim.buildings.values()) {
      const wp = sim.component<{ profession: string }>(b, 'workplace')
      if (!wp || b.site) continue
      const prof = sim.content.professions.get(wp.profession)
      let row = rows.get(wp.profession)
      if (!row) {
        row = { id: wp.profession, name: prof?.name ?? wp.profession, color: prof?.color ?? '#888', workers: 0, target: 0, max: 0, buildings: [] }
        rows.set(wp.profession, row)
      }
      row.workers += b.workers.length
      row.target += b.workerTarget
      row.max += sim.maxWorkers(b)
      row.buildings.push(b.id)
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private selectionInfo(): BuildingInfo | CitizenInfo | null {
    const sel = this.selected
    if (!sel) return null
    if (sel.kind === 'citizen') {
      const c = this.sim.citizens.get(sel.id)
      if (!c) {
        this.selected = null
        return null
      }
      return this.citizenInfo(c)
    }
    const b = this.sim.buildings.get(sel.id)
    if (!b) {
      this.selected = null
      this.renderer.buildings.selected = 0
      return null
    }
    return this.buildingInfo(b)
  }

  private citizenInfo(c: Citizen): CitizenInfo {
    const sim = this.sim
    const name = (id: number) => {
      const b = sim.buildings.get(id)
      return b ? sim.def(b).name : null
    }
    return {
      kind: 'citizen',
      id: c.id,
      name: c.name,
      age: Math.floor(c.age / 12),
      female: c.female,
      profession: sim.content.professions.get(c.profession)?.name ?? c.profession,
      home: name(c.home),
      workplace: name(c.workplace),
      task: c.task?.label ?? null,
      hunger: c.hunger,
      warmth: c.warmth,
      health: c.health,
      happiness: c.happiness,
      tools: c.tools,
      coat: c.coat,
      sick: c.sick > 0,
      carrying: c.carry ? Object.entries(c.carry).map(([r, q]) => `${Math.round(q)} ${sim.resource(r)?.name ?? r}`).join(', ') : null,
      automaton: c.automaton ? { wind: c.wind ?? 0, windMonths: sim.rules.automaton.windMonths } : null,
    }
  }

  private buildingInfo(b: Building): BuildingInfo {
    const sim = this.sim
    const def = sim.def(b)
    const lines: string[] = []
    if (!b.site) for (const [handler, cfg] of sim.components(b)) lines.push(...(handler.describe?.(sim, b, cfg) ?? []))
    const options: OptionInfo[] = []
    const producer = sim.component<ProducerConfig>(b, 'producer')
    const recipes = producer?.recipes.filter((id) => isUnlocked(sim, 'recipe', id)) ?? []
    if (producer && recipes.length > 1) {
      options.push({
        key: 'recipe',
        label: 'Recipe',
        value: currentRecipe(sim, b, producer).id,
        values: recipes.map((id) => ({ id, name: sim.content.recipes.get(id)?.name ?? id })),
      })
    }
    if (sim.def(b).components.assembler) {
      const target = typeof b.data.target === 'number' ? String(b.data.target) : 'none'
      options.push({
        key: 'target',
        label: 'Build automatons until there are',
        value: target,
        values: [{ id: 'none', name: 'No limit' }, ...[0, 2, 4, 6, 8, 10, 15, 20, 30].map((n) => ({ id: String(n), name: String(n) }))],
      })
    }
    const field = sim.component<FieldConfig>(b, 'field')
    if (field) {
      options.push({
        key: 'crop',
        label: 'Crop',
        value: (b.data.crop as string) ?? field.crops[0],
        values: field.crops.map((id) => ({ id, name: sim.content.crops.get(id)?.name ?? id })),
      })
    }
    const cost = def.cost.resources
    return {
      kind: 'building',
      id: b.id,
      def: def.id,
      name: def.name,
      description: def.description,
      site: b.site
        ? {
            stage: b.site.stage,
            progress: Math.min(1, b.site.work / totalWork(sim, b)),
            materials: Object.entries(cost).map(([id, need]) => ({ id, name: sim.resource(id)?.name ?? id, have: Math.floor(b.site!.delivered[id] ?? 0), need })),
            priority: b.site.priority,
          }
        : null,
      workers: b.workers.map((id) => ({ id, name: sim.citizens.get(id)?.name ?? '?' })),
      workerTarget: b.workerTarget,
      maxWorkers: b.site ? 0 : sim.maxWorkers(b),
      residents: b.residents.map((id) => {
        const c = sim.citizens.get(id)
        return { id, name: c?.name ?? '?', age: Math.floor((c?.age ?? 0) / 12) }
      }),
      lines,
      stock: Object.entries(b.stock)
        .filter(([, q]) => q >= 0.5)
        .sort((a, z) => z[1] - a[1])
        .map(([id, amount]) => ({ id, name: sim.resource(id)?.name ?? id, amount })),
      options,
      canDemolish: !def.components.shelter,
      burning: b.fire > 0,
    }
  }

  // ---------------------------------------------------------------- teardown

  destroy(): void {
    if (this.destroyed) return
    void this.autosave()
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    for (const fn of this.cleanup) fn()
    this.ambience.stop()
    this.renderer.dispose()
    useHud.setState(initialHud)
  }
}
