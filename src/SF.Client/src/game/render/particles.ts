import * as THREE from 'three'

export type ParticleKind = 'smoke' | 'soot' | 'steam' | 'fire' | 'dust' | 'snow'

interface KindSpec {
  color: [number, number, number]
  life: number
  size: number
  rise: number
  grow: number
  alpha: number
  /** How readily the particle is carried by the wind (0 = not at all, 1 = at wind speed). */
  drift: number
}

const KIND: Record<ParticleKind, KindSpec> = {
  /** Wood smoke from cottage stoves. */
  smoke: { color: [0.4, 0.38, 0.36], life: 4.5, size: 0.5, rise: 0.7, grow: 1.4, alpha: 0.5, drift: 1 },
  /** Thick coal smoke from furnaces and boilers: dark, long-lived, and it spreads into a pall. */
  soot: { color: [0.12, 0.11, 0.1], life: 8, size: 0.9, rise: 0.9, grow: 3, alpha: 0.78, drift: 1 },
  steam: { color: [0.92, 0.92, 0.9], life: 2.6, size: 0.45, rise: 1.2, grow: 1.6, alpha: 0.5, drift: 0.7 },
  fire: { color: [1, 0.55, 0.18], life: 0.9, size: 0.45, rise: 1.8, grow: -0.3, alpha: 0.9, drift: 0.2 },
  dust: { color: [0.62, 0.52, 0.38], life: 1.2, size: 0.35, rise: 0.3, grow: 0.8, alpha: 0.4, drift: 0.4 },
  snow: { color: [0.95, 0.97, 1], life: 6, size: 0.12, rise: -0.6, grow: 0, alpha: 0.85, drift: 0.5 },
}

/**
 * CPU-simulated billboard particles in a single Points draw call: chimney smoke, boiler steam, fire and dust.
 * Purely cosmetic, so it may use Math.random freely.
 */
export class Particles {
  readonly points: THREE.Points
  private readonly capacity: number
  private readonly pos: Float32Array
  private readonly color: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly vel: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly kind: Uint8Array
  private next = 0
  private readonly kinds = Object.keys(KIND) as ParticleKind[]
  scale = 1
  /** Wind in world units per second (x and z); plumes lean with it as they rise. */
  readonly wind = new THREE.Vector2()

  constructor(capacity: number) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.color = new Float32Array(capacity * 3)
    this.size = new Float32Array(capacity)
    this.alpha = new Float32Array(capacity)
    this.vel = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity)
    this.kind = new Uint8Array(capacity)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vColor, vAlpha * (1.0 - r) * (1.0 - r));
        }`,
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(geo, material)
    this.points.frustumCulled = false
  }

  setViewportHeight(height: number): void {
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = height / 2
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, spread = 0.1): void {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    const k = KIND[kind]
    this.pos[i * 3] = x + (Math.random() - 0.5) * spread
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread
    this.vel[i * 3] = (Math.random() - 0.5) * 0.25
    this.vel[i * 3 + 1] = k.rise * (0.7 + Math.random() * 0.6)
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25
    this.maxLife[i] = this.life[i] = k.life * (0.7 + Math.random() * 0.6)
    this.kind[i] = this.kinds.indexOf(kind)
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0
        continue
      }
      this.life[i] -= dt
      const k = KIND[this.kinds[this.kind[i]]]
      const t = 1 - this.life[i] / this.maxLife[i]
      // Plumes leave the chimney upright and bend over as the wind takes them.
      const take = Math.min(1, dt * 0.7 * k.drift)
      this.vel[i * 3] += (this.wind.x * k.drift - this.vel[i * 3]) * take
      this.vel[i * 3 + 2] += (this.wind.y * k.drift - this.vel[i * 3 + 2]) * take
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      this.vel[i * 3 + 1] *= 0.995
      this.size[i] = Math.max(0.02, k.size * (1 + k.grow * t)) * this.scale
      this.alpha[i] = this.life[i] > 0 ? k.alpha * Math.min(1, t * 6) * (1 - t) : 0
      const fade = this.kinds[this.kind[i]] === 'fire' ? 1 - t * 0.6 : 1
      this.color[i * 3] = k.color[0] * fade
      this.color[i * 3 + 1] = k.color[1] * fade * (this.kinds[this.kind[i]] === 'fire' ? 1 - t * 0.5 : 1)
      this.color[i * 3 + 2] = k.color[2] * fade
    }
    const geo = this.points.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.size.needsUpdate = true
    geo.attributes.alpha.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
