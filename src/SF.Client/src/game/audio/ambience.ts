import { AudioEngine } from './engine'
import { play } from './synth'

interface Bed {
  stop: () => void
}

export interface AmbienceOptions {
  /** Running water nearby (rivers, lakes). */
  water: boolean
  /** Industry hum: boilers, smelters and machine works in the colony. */
  industry: boolean
  /** Cold wind beds for winter. */
  winter: boolean
}

/**
 * Continuous colony soundscape built from filtered noise and slow LFOs: a breeze everywhere, water, winter wind,
 * the hum and hiss of steam industry, and occasional birdsong-like chirps in the warm months.
 */
export class Ambience {
  private beds: Bed[] = []
  private timers: number[] = []
  private generation = 0
  private current = ''

  start(options: AmbienceOptions): void {
    const key = JSON.stringify(options)
    if (key === this.current) return
    this.stop()
    this.current = key
    const engine = AudioEngine.get()
    const ctx = engine.ensure()
    if (!ctx) {
      const generation = this.generation
      engine.onReady(() => {
        if (generation === this.generation) {
          this.current = ''
          this.start(options)
        }
      })
      return
    }
    const out = engine.bus('ambience')
    this.beds.push(this.noiseBed(ctx, out, 'bandpass', 420, 0.8, options.winter ? 0.09 : 0.04, 0.08, true))
    if (options.water) this.beds.push(this.noiseBed(ctx, out, 'lowpass', 500, 0.7, 0.06, 0.12, true))
    if (options.industry) {
      this.beds.push(this.hum(ctx, out))
      this.every(5, 11, () => play('hiss', { bus: 'ambience', volume: 0.35, pan: Math.random() * 2 - 1, cooldown: 0 }))
    }
    if (!options.winter) this.every(3, 8, () => play('click', { bus: 'ambience', volume: 0.08, pan: Math.random() * 2 - 1, cooldown: 0 }))
  }

  stop(): void {
    this.generation++
    this.current = ''
    for (const b of this.beds) b.stop()
    for (const t of this.timers) window.clearTimeout(t)
    this.beds = []
    this.timers = []
  }

  private every(min: number, max: number, fn: () => void): void {
    const schedule = () => {
      const id = window.setTimeout(() => {
        fn()
        schedule()
      }, (min + Math.random() * (max - min)) * 1000)
      this.timers.push(id)
    }
    schedule()
  }

  private hum(ctx: AudioContext, out: AudioNode): Bed {
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(0.05, ctx.currentTime, 1.5)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 160
    const a = ctx.createOscillator()
    a.type = 'sawtooth'
    a.frequency.value = 49
    const b = ctx.createOscillator()
    b.frequency.value = 98.5
    a.connect(f)
    b.connect(f)
    f.connect(g).connect(out)
    a.start()
    b.start()
    return {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
        a.stop(ctx.currentTime + 1.5)
        b.stop(ctx.currentTime + 1.5)
      },
    }
  }

  /** Looping filtered noise with a slow LFO on its level for movement. */
  private noiseBed(ctx: AudioContext, out: AudioNode, type: BiquadFilterType, freq: number, q: number, level: number, lfoRate: number, pink: boolean): Bed {
    const engine = AudioEngine.get()
    const src = ctx.createBufferSource()
    src.buffer = pink ? engine.pinkNoise() : engine.whiteNoise()
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.value = 0
    g.gain.setTargetAtTime(level, ctx.currentTime, 2)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = lfoRate
    const depth = ctx.createGain()
    depth.gain.value = level * 0.5
    lfo.connect(depth).connect(g.gain)
    src.connect(f).connect(g).connect(out)
    src.start()
    lfo.start()
    return {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
        src.stop(ctx.currentTime + 1.5)
        lfo.stop(ctx.currentTime + 1.5)
      },
    }
  }
}
