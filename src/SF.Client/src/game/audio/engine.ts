import { useSettings, type Settings } from '../../state/settings'

export type Bus = 'music' | 'sfx' | 'ambience' | 'ui'

/**
 * Optional recorded assets. Any sound or music stem listed here is streamed from the URL instead of being synthesised,
 * so professionally produced audio can replace the procedural fallback without code changes.
 */
export const AUDIO_MANIFEST: Partial<Record<string, string>> = {}

/**
 * Owns the AudioContext and mixer: master → compressor → destination, with per-bus gains driven by settings.
 * Browsers only allow audio after a user gesture, so the context is created lazily and resumed on first input.
 */
export class AudioEngine {
  private static instance: AudioEngine | null = null
  ctx: AudioContext | null = null
  private master!: GainNode
  private buses!: Record<Bus, GainNode>
  private noise: AudioBuffer | null = null
  private pink: AudioBuffer | null = null
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly lastPlayed = new Map<string, number>()
  private readonly active = new Map<string, number>()
  private voices = 0
  private readonly readyCallbacks: (() => void)[] = []
  static readonly MAX_VOICES = 40

  static get(): AudioEngine {
    AudioEngine.instance ??= new AudioEngine()
    return AudioEngine.instance
  }

  private constructor() {
    if (typeof window === 'undefined') return
    const unlock = () => this.ensure(true)
    window.addEventListener('pointerdown', unlock, { once: false, passive: true })
    window.addEventListener('keydown', unlock, { once: false })
    useSettings.subscribe((s) => this.applySettings(s.settings))
  }

  /**
   * Creates the context (and resumes it when called from a user gesture). Safe to call often; before the first
   * gesture the context simply stays suspended and starts playing as soon as the player touches the screen.
   */
  ensure(fromGesture = false): AudioContext | null {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null
    if (!this.ctx && !fromGesture) return null
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -16
      compressor.knee.value = 12
      compressor.ratio.value = 4
      compressor.attack.value = 0.004
      compressor.release.value = 0.2
      this.master = ctx.createGain()
      this.master.connect(compressor).connect(ctx.destination)
      this.buses = {
        music: ctx.createGain(),
        sfx: ctx.createGain(),
        ambience: ctx.createGain(),
        ui: ctx.createGain(),
      }
      for (const bus of Object.values(this.buses)) bus.connect(this.master)
      this.ctx = ctx
      this.noise = this.makeNoise(ctx, 2, false)
      this.pink = this.makeNoise(ctx, 3, true)
      this.applySettings(useSettings.getState().settings)
      for (const cb of this.readyCallbacks.splice(0)) cb()
    }
    if (fromGesture && this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private applySettings(s: Settings): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05)
    this.buses.music.gain.setTargetAtTime(s.musicVolume * 0.55, t, 0.05)
    this.buses.sfx.gain.setTargetAtTime(s.sfxVolume * 0.8, t, 0.05)
    this.buses.ambience.gain.setTargetAtTime(s.ambienceVolume * 0.6, t, 0.05)
    this.buses.ui.gain.setTargetAtTime(s.sfxVolume * 0.6, t, 0.05)
  }

  /** Runs `cb` once audio is available (immediately if it already is). */
  onReady(cb: () => void): void {
    if (this.ctx) cb()
    else this.readyCallbacks.push(cb)
  }

  bus(name: Bus): GainNode {
    return this.buses[name]
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0
  }

  whiteNoise(): AudioBuffer {
    return this.noise!
  }

  pinkNoise(): AudioBuffer {
    return this.pink!
  }

  private makeNoise(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      if (!pink) {
        data[i] = white
        continue
      }
      b0 = 0.99765 * b0 + white * 0.099046
      b1 = 0.963 * b1 + white * 0.2965164
      b2 = 0.57 * b2 + white * 1.0526913
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2
    }
    return buffer
  }

  /**
   * Admission control for a one-shot: drops it if the same sound fired within `cooldown` seconds, if too many of that
   * sound are ringing, or if the global voice budget is spent. Returns a release callback, or null when refused.
   */
  admit(key: string, cooldown: number, maxConcurrent: number, duration: number): (() => void) | null {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return null
    const now = ctx.currentTime
    if (now - (this.lastPlayed.get(key) ?? -1) < cooldown) return null
    const count = this.active.get(key) ?? 0
    if (count >= maxConcurrent || this.voices >= AudioEngine.MAX_VOICES) return null
    this.lastPlayed.set(key, now)
    this.active.set(key, count + 1)
    this.voices++
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.active.set(key, Math.max(0, (this.active.get(key) ?? 1) - 1))
      this.voices = Math.max(0, this.voices - 1)
    }
    window.setTimeout(release, duration * 1000 + 50)
    return release
  }

  /** Loads a manifest asset if one is declared; resolves null to fall back to synthesis. */
  async sample(id: string): Promise<AudioBuffer | null> {
    const url = AUDIO_MANIFEST[id]
    const ctx = this.ctx
    if (!url || !ctx) return null
    const hit = this.buffers.get(id)
    if (hit) return hit
    try {
      const data = await (await fetch(url)).arrayBuffer()
      const buffer = await ctx.decodeAudioData(data)
      this.buffers.set(id, buffer)
      return buffer
    } catch {
      return null
    }
  }
}
