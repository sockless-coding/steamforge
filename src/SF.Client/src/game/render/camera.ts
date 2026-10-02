import * as THREE from 'three'

const MIN_DISTANCE = 4
const MAX_DISTANCE = 150

/**
 * RTS orbit camera. The rig orbits a ground target: distance zooms, yaw rotates, and pitch follows zoom (low and
 * cinematic up close, near top-down far out). All inputs set goals that the rig eases toward each frame.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  readonly target = new THREE.Vector3()
  private goal = new THREE.Vector3()
  distance = 38
  private goalDistance = 38
  yaw = Math.PI * 0.25
  private goalYaw = Math.PI * 0.25
  /** Extra pitch the player added by dragging (radians). */
  private pitchOffset = 0
  private readonly keys = new Set<string>()
  private bounds = { w: 128, h: 128 }
  edgeScroll = false
  private edge = { x: 0, y: 0 }
  heightAt: (x: number, z: number) => number = () => 0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.3, 900)
  }

  setBounds(w: number, h: number): void {
    this.bounds = { w, h }
  }

  jumpTo(x: number, z: number, distance?: number): void {
    this.goal.set(x, 0, z)
    this.target.copy(this.goal)
    if (distance) this.distance = this.goalDistance = distance
  }

  focus(x: number, z: number): void {
    this.goal.set(x, 0, z)
  }

  keyDown(code: string): void {
    this.keys.add(code)
  }

  keyUp(code: string): void {
    this.keys.delete(code)
  }

  clearKeys(): void {
    this.keys.clear()
  }

  zoom(deltaY: number): void {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * Math.exp(deltaY * 0.0012), MIN_DISTANCE, MAX_DISTANCE)
  }

  zoomBy(factor: number): void {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, MIN_DISTANCE, MAX_DISTANCE)
  }

  rotate(dx: number, dy = 0): void {
    this.goalYaw -= dx * 0.006
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + dy * 0.004, -0.35, 0.35)
  }

  rotateBy(angle: number): void {
    this.goalYaw += angle
  }

  /** Pans by a screen-space drag in pixels, scaled so the ground under the cursor roughly follows it. */
  pan(dx: number, dy: number, viewportHeight: number): void {
    const scale = (this.distance * 1.1) / viewportHeight
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    this.goal.x += (-dx * cos - dy * sin) * scale
    this.goal.z += (dx * sin - dy * cos) * scale
  }

  setEdge(x: number, y: number): void {
    this.edge = { x, y }
  }

  private pitch(): number {
    const t = Math.max(0, (this.distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE))
    return THREE.MathUtils.clamp(0.55 + Math.sqrt(t) * 0.75 + this.pitchOffset, 0.3, 1.45)
  }

  update(dt: number): void {
    const speed = this.distance * 1.15 * dt
    let fx = 0
    let fz = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1
    if (this.edgeScroll) {
      fx += this.edge.x
      fz += this.edge.y
    }
    if (fx || fz) {
      const sin = Math.sin(this.yaw)
      const cos = Math.cos(this.yaw)
      this.goal.x += (fx * cos + fz * sin) * speed
      this.goal.z += (-fx * sin + fz * cos) * speed
    }
    if (this.keys.has('KeyQ')) this.goalYaw += 1.6 * dt
    if (this.keys.has('KeyE')) this.goalYaw -= 1.6 * dt
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.zoomBy(Math.exp(-1.5 * dt))
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoomBy(Math.exp(1.5 * dt))

    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 0, this.bounds.w)
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, this.bounds.h)

    const k = 1 - Math.exp(-dt * 10)
    this.target.x += (this.goal.x - this.target.x) * k
    this.target.z += (this.goal.z - this.target.z) * k
    this.target.y += (Math.max(0, this.heightAt(this.target.x, this.target.z)) - this.target.y) * k
    this.distance += (this.goalDistance - this.distance) * k
    this.yaw += (this.goalYaw - this.yaw) * k

    const pitch = this.pitch()
    const horizontal = Math.cos(pitch) * this.distance
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    )
    // Never dip below the ground on hills.
    const ground = this.heightAt(this.camera.position.x, this.camera.position.z) + 1.5
    if (this.camera.position.y < ground) this.camera.position.y = ground
    this.camera.lookAt(this.target)
  }
}
