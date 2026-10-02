import { AudioEngine } from './engine'

type Mode = 'off' | 'menu' | 'battle' | 'boss'

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// Chord tones as MIDI note numbers (root position, octave 3).
const PROGRESSIONS: Record<Exclude<Mode, 'off'>, number[][]> = {
  // Dm9 – Bbmaj7 – Gm7 – A7sus: wistful workshop.
  menu: [[50, 53, 57, 64], [46, 50, 53, 57], [43, 50, 53, 58], [45, 50, 52, 55]],
  // i – VI – III – VII in D minor: driving, heroic.
  battle: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],
  // i – bII – i – V: menace for bosses.
  boss: [[50, 53, 57], [51, 55, 58], [50, 53, 57], [45, 49, 52]],
}

const TEMPO: Record<Exclude<Mode, 'off'>, number> = { menu: 72, battle: 100, boss: 112 }

interface Layers {
  pad: GainNode
  bass: GainNode
  drums: GainNode
  ostinato: GainNode
  brass: GainNode
  bells: GainNode
}

/**
 * Generative score. A lookahead scheduler places notes on the Web Audio clock; layer gains follow the battle's
 * intensity (quiet build phase → drums and ostinato under pressure → brass and a darker progression for bosses).
 */
export class MusicDirector {
  private static instance: MusicDirector | null = null
  private mode: Mode = 'off'
  private intensity = 0
  private layers: Layers | null = null
  private timer = 0
  private step = 0
  private nextTime = 0
  private melodyNote = 62

  static get(): MusicDirector {
    MusicDirector.instance ??= new MusicDirector()
    return MusicDirector.instance
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return
    const previous = this.mode
    this.mode = mode
    const ctx = AudioEngine.get().ensure()
    if (!ctx) {
      // Audio unlocks on the first gesture; start whatever mode is current at that point.
      AudioEngine.get().onReady(() => {
        const wanted = this.mode
        this.mode = 'off'
        this.setMode(wanted)
      })
      return
    }
    if (mode === 'off') {
      this.stopScheduler()
      this.fadeAll(0, 1.5)
      return
    }
    this.ensureLayers(ctx)
    if (previous === 'off' || !this.timer) {
      this.step = 0
      this.nextTime = ctx.currentTime + 0.1
      this.startScheduler()
    }
    this.applyIntensity()
  }

  /** 0 = calm, 1 = frantic. Smoothed through gain ramps. */
  setIntensity(value: number): void {
    const v = Math.max(0, Math.min(1, value))
    if (Math.abs(v - this.intensity) < 0.03) return
    this.intensity = v
    this.applyIntensity()
  }

  private ensureLayers(ctx: AudioContext): void {
    if (this.layers) return
    const bus = AudioEngine.get().bus('music')
    const make = () => {
      const g = ctx.createGain()
      g.gain.value = 0
      g.connect(bus)
      return g
    }
    this.layers = { pad: make(), bass: make(), drums: make(), ostinato: make(), brass: make(), bells: make() }
  }

  private applyIntensity(): void {
    const l = this.layers
    const ctx = AudioEngine.get().ctx
    if (!l || !ctx) return
    const i = this.intensity
    const boss = this.mode === 'boss'
    const menu = this.mode === 'menu'
    const t = ctx.currentTime
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 1.2)
    set(l.pad, menu ? 0.5 : 0.35)
    set(l.bells, menu ? 0.45 : 0)
    set(l.bass, menu ? 0 : i > 0.15 || boss ? 0.5 : 0.2)
    set(l.drums, menu ? 0 : boss ? 0.8 : i > 0.3 ? 0.35 + i * 0.4 : 0)
    set(l.ostinato, menu ? 0 : boss ? 0.45 : i > 0.5 ? 0.25 + (i - 0.5) * 0.6 : 0)
    set(l.brass, menu ? 0 : boss ? 0.6 : i > 0.78 ? 0.35 : 0)
  }

  private fadeAll(value: number, time: number): void {
    const l = this.layers
    const ctx = AudioEngine.get().ctx
    if (!l || !ctx) return
    for (const g of Object.values(l)) g.gain.setTargetAtTime(value, ctx.currentTime, time / 3)
  }

  private startScheduler(): void {
    this.stopScheduler()
    this.timer = window.setInterval(() => this.schedule(), 50)
  }

  private stopScheduler(): void {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = 0
  }

  private schedule(): void {
    const ctx = AudioEngine.get().ctx
    if (!ctx || this.mode === 'off' || !this.layers) return
    const mode = this.mode
    const sixteenth = 60 / TEMPO[mode] / 4
    while (this.nextTime < ctx.currentTime + 0.2) {
      this.playStep(ctx, mode, this.step, this.nextTime, sixteenth)
      this.step = (this.step + 1) % 256
      this.nextTime += sixteenth
    }
  }

  private playStep(ctx: AudioContext, mode: Exclude<Mode, 'off'>, step: number, t: number, sixteenth: number): void {
    const l = this.layers!
    const bar = Math.floor(step / 16)
    const beat = step % 16
    const prog = PROGRESSIONS[mode]
    const chord = prog[bar % prog.length]
    const barLength = sixteenth * 16

    if (beat === 0) {
      // Sustained string pad, a detuned saw ensemble through a slow filter.
      for (const n of chord) {
        for (const detune of [-7, 5]) {
          const o = ctx.createOscillator()
          o.type = 'sawtooth'
          o.frequency.value = midi(n)
          o.detune.value = detune
          const f = ctx.createBiquadFilter()
          f.type = 'lowpass'
          f.frequency.setValueAtTime(500, t)
          f.frequency.linearRampToValueAtTime(mode === 'menu' ? 1100 : 1500, t + barLength * 0.5)
          f.frequency.linearRampToValueAtTime(600, t + barLength)
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, t)
          g.gain.linearRampToValueAtTime(0.035, t + barLength * 0.3)
          g.gain.linearRampToValueAtTime(0, t + barLength * 1.05)
          o.connect(f).connect(g).connect(l.pad)
          o.start(t)
          o.stop(t + barLength * 1.1)
        }
      }
    }

    if (mode !== 'menu' && beat % 2 === 0) {
      // Driving eighth-note bass on the chord root.
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = midi(chord[0] - 12)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 380
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + sixteenth * 1.8)
      o.connect(f).connect(g).connect(l.bass)
      o.start(t)
      o.stop(t + sixteenth * 2)
    }

    if (mode !== 'menu') {
      const intense = this.intensity > 0.65 || mode === 'boss'
      if (beat === 0 || beat === 8 || (intense && (beat === 6 || beat === 14))) this.kick(ctx, t, l.drums)
      if (beat === 4 || beat === 12) this.anvil(ctx, t, l.drums, mode === 'boss' ? 0.9 : 1)
      if (beat % 2 === 0 || (intense && beat % 1 === 0)) this.hat(ctx, t, l.drums, beat % 4 === 2 ? 0.05 : 0.025)
    }

    if (mode !== 'menu') {
      // Staccato ostinato arpeggio.
      const n = chord[[0, 1, 2, 1][beat % 4]] + 12 + (beat >= 8 ? 12 : 0)
      this.pluck(ctx, t, midi(n), l.ostinato, sixteenth * 0.9)
    }

    if (mode !== 'menu' && (beat === 0 || beat === 10)) {
      // Brass statement on root and fifth.
      const n = beat === 0 ? chord[0] + 12 : chord[2] + 12
      this.brass(ctx, t, midi(n), l.brass, beat === 0 ? sixteenth * 9 : sixteenth * 5)
    }

    if (mode === 'menu' && beat % 4 === 0 && Math.random() < 0.8) {
      // Music-box melody wandering over the chord.
      const scale = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77]
      const idx = scale.indexOf(this.melodyNote)
      const next = Math.max(0, Math.min(scale.length - 1, (idx < 0 ? 4 : idx) + Math.round((Math.random() - 0.5) * 4)))
      this.melodyNote = scale[next]
      this.bell(ctx, t, midi(this.melodyNote + 12), l.bells)
    }
  }

  private kick(ctx: AudioContext, t: number, out: AudioNode): void {
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(120, t)
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.35, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.3)
  }

  private anvil(ctx: AudioContext, t: number, out: AudioNode, v: number): void {
    const carrier = ctx.createOscillator()
    carrier.frequency.value = 520
    const mod = ctx.createOscillator()
    mod.frequency.value = 520 * 2.76
    const mg = ctx.createGain()
    mg.gain.setValueAtTime(900, t)
    mg.gain.exponentialRampToValueAtTime(1, t + 0.3)
    mod.connect(mg).connect(carrier.frequency)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.09 * v, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    carrier.connect(g).connect(out)
    carrier.start(t)
    mod.start(t)
    carrier.stop(t + 0.4)
    mod.stop(t + 0.4)
  }

  private hat(ctx: AudioContext, t: number, out: AudioNode, v: number): void {
    const src = ctx.createBufferSource()
    src.buffer = AudioEngine.get().whiteNoise()
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = ctx.createGain()
    g.gain.setValueAtTime(v, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(f).connect(g).connect(out)
    src.start(t, Math.random())
    src.stop(t + 0.06)
  }

  private pluck(ctx: AudioContext, t: number, freq: number, out: AudioNode, dur: number): void {
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.07, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private brass(ctx: AudioContext, t: number, freq: number, out: AudioNode, dur: number): void {
    for (const detune of [-4, 4]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      o.detune.value = detune
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(400, t)
      f.frequency.linearRampToValueAtTime(1800, t + 0.12)
      f.frequency.linearRampToValueAtTime(900, t + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.05, t + 0.06)
      g.gain.linearRampToValueAtTime(0.035, t + dur * 0.7)
      g.gain.linearRampToValueAtTime(0, t + dur)
      o.connect(f).connect(g).connect(out)
      o.start(t)
      o.stop(t + dur + 0.05)
    }
  }

  private bell(ctx: AudioContext, t: number, freq: number, out: AudioNode): void {
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const o2 = ctx.createOscillator()
    o2.frequency.value = freq * 3.01
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.06, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.015, t)
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    o.connect(g).connect(out)
    o2.connect(g2).connect(out)
    o.start(t)
    o2.start(t)
    o.stop(t + 1.7)
    o2.stop(t + 0.7)
  }
}
