import { AUDIO_MANIFEST, AudioEngine, type Bus } from './engine'

/** A procedural sound recipe: builds a node graph into `out` starting at `t`, returns its length in seconds. */
type Recipe = (ctx: AudioContext, out: AudioNode, t: number, engine: AudioEngine, v: number) => number

function env(ctx: AudioContext, t: number, attack: number, decay: number, peak: number, sustain = 0): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + attack + decay)
  return g
}

function noiseSource(ctx: AudioContext, engine: AudioEngine, pink = false, rate = 1): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = pink ? engine.pinkNoise() : engine.whiteNoise()
  src.playbackRate.value = rate
  src.loop = true
  return src
}

function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function osc(ctx: AudioContext, type: OscillatorType, freq: number): OscillatorNode {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.value = freq
  return o
}

const vary = (v: number, amount = 0.08) => v * (1 + (Math.random() - 0.5) * amount * 2)

/** Low thump with a pitch drop: the body of cannons, mortars and explosions. */
function thump(ctx: AudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, peak: number) {
  const o = osc(ctx, 'sine', from)
  o.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = env(ctx, t, 0.005, dur, peak)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + dur + 0.05)
}

function burst(ctx: AudioContext, engine: AudioEngine, out: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, dur: number, peak: number, pink = false) {
  const n = noiseSource(ctx, engine, pink, vary(1, 0.2))
  const f = filter(ctx, type, freq, q)
  const g = env(ctx, t, 0.003, dur, peak)
  n.connect(f).connect(g).connect(out)
  n.start(t, Math.random() * 1.5)
  n.stop(t + dur + 0.05)
}

function bell(ctx: AudioContext, out: AudioNode, t: number, freq: number, dur: number, peak: number, ratio = 3.5, index = 200) {
  const carrier = osc(ctx, 'sine', freq)
  const mod = osc(ctx, 'sine', freq * ratio)
  const modGain = ctx.createGain()
  modGain.gain.setValueAtTime(index, t)
  modGain.gain.exponentialRampToValueAtTime(1, t + dur)
  mod.connect(modGain).connect(carrier.frequency)
  const g = env(ctx, t, 0.003, dur, peak)
  carrier.connect(g).connect(out)
  carrier.start(t)
  mod.start(t)
  carrier.stop(t + dur + 0.05)
  mod.stop(t + dur + 0.05)
}

function brassNote(ctx: AudioContext, out: AudioNode, t: number, v: number, f: number): number {
  const o = osc(ctx, 'sawtooth', f)
  const o2 = osc(ctx, 'sawtooth', f * 1.004)
  const lp = filter(ctx, 'lowpass', 600)
  lp.frequency.setValueAtTime(500, t)
  lp.frequency.linearRampToValueAtTime(2200, t + 0.15)
  lp.frequency.linearRampToValueAtTime(900, t + 0.8)
  const g = env(ctx, t, 0.05, 0.9, 0.12 * v, 0.02)
  o.connect(lp)
  o2.connect(lp)
  lp.connect(g).connect(out)
  o.start(t)
  o2.start(t)
  o.stop(t + 1)
  o2.stop(t + 1)
  return 1
}

export const RECIPES: Record<string, Recipe> = {
  cannon: (ctx, out, t, e, v) => {
    thump(ctx, out, t, vary(140), 45, 0.28, 0.9 * v)
    burst(ctx, e, out, t, 'lowpass', 1800, 0.7, 0.14, 0.5 * v)
    burst(ctx, e, out, t + 0.02, 'bandpass', 3200, 2, 0.05, 0.25 * v)
    return 0.35
  },
  gatling: (ctx, out, t, e, v) => {
    burst(ctx, e, out, t, 'bandpass', vary(2400, 0.15), 3, 0.035, 0.45 * v)
    thump(ctx, out, t, 220, 90, 0.05, 0.25 * v)
    return 0.07
  },
  rail: (ctx, out, t, e, v) => {
    const o = osc(ctx, 'sawtooth', 300)
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.12)
    const f = filter(ctx, 'bandpass', 1600, 4)
    const g = env(ctx, t, 0.01, 0.35, 0.35 * v)
    o.connect(f).connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.4)
    burst(ctx, e, out, t + 0.1, 'highpass', 3000, 0.8, 0.25, 0.5 * v)
    thump(ctx, out, t + 0.1, 90, 40, 0.3, 0.6 * v)
    return 0.45
  },
  mortar: (ctx, out, t, e, v) => {
    thump(ctx, out, t, 90, 35, 0.45, 1 * v)
    burst(ctx, e, out, t, 'lowpass', 600, 0.7, 0.3, 0.4 * v, true)
    return 0.5
  },
  flak: (ctx, out, t, e, v) => {
    thump(ctx, out, t, 180, 60, 0.18, 0.6 * v)
    burst(ctx, e, out, t, 'bandpass', 1400, 1.5, 0.1, 0.45 * v)
    return 0.2
  },
  harpoon: (ctx, out, t, e, v) => {
    burst(ctx, e, out, t, 'bandpass', 900, 3, 0.12, 0.4 * v)
    bell(ctx, out, t, 180, 0.3, 0.15 * v, 2.7, 80)
    return 0.3
  },
  zap: (ctx, out, t, e, v) => {
    // Electric crackle: noise gated by a fast random square LFO.
    const n = noiseSource(ctx, e)
    const f = filter(ctx, 'bandpass', vary(3000, 0.3), 1.2)
    const gate = ctx.createGain()
    gate.gain.value = 0
    const lfo = osc(ctx, 'square', vary(60, 0.4))
    const depth = ctx.createGain()
    depth.gain.value = 0.5
    lfo.connect(depth).connect(gate.gain)
    const g = env(ctx, t, 0.002, 0.22, 0.6 * v)
    n.connect(f).connect(gate).connect(g).connect(out)
    const buzz = osc(ctx, 'sawtooth', vary(110, 0.1))
    const bg = env(ctx, t, 0.002, 0.18, 0.12 * v)
    buzz.connect(filter(ctx, 'highpass', 800)).connect(bg).connect(out)
    for (const node of [n, lfo, buzz]) {
      node.start(t)
      node.stop(t + 0.3)
    }
    return 0.3
  },
  thunder: (ctx, out, t, e, v) => {
    RECIPES.zap(ctx, out, t, e, v)
    thump(ctx, out, t + 0.03, 70, 30, 0.9, 0.9 * v)
    burst(ctx, e, out, t + 0.05, 'lowpass', 500, 0.5, 1.2, 0.6 * v, true)
    return 1.3
  },
  flame: (ctx, out, t, e, v) => {
    burst(ctx, e, out, t, 'lowpass', vary(900, 0.2), 0.8, 0.35, 0.35 * v, true)
    burst(ctx, e, out, t, 'bandpass', 2400, 0.8, 0.12, 0.08 * v)
    return 0.4
  },
  hiss: (ctx, out, t, e, v) => {
    burst(ctx, e, out, t, 'highpass', vary(4500, 0.2), 0.7, 0.45, 0.22 * v)
    return 0.5
  },
  glob: (ctx, out, t, e, v) => {
    const o = osc(ctx, 'sine', 420)
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12)
    const g = env(ctx, t, 0.005, 0.14, 0.35 * v)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.2)
    burst(ctx, e, out, t, 'bandpass', 1200, 4, 0.08, 0.15 * v)
    return 0.2
  },
  hammer: (ctx, out, t, e, v) => {
    thump(ctx, out, t, 110, 40, 0.35, 1 * v)
    bell(ctx, out, t, 240, 0.5, 0.25 * v, 2.76, 400)
    burst(ctx, e, out, t, 'lowpass', 900, 0.8, 0.2, 0.3 * v)
    return 0.55
  },
  saw: (ctx, out, t, _e, v) => {
    const o = osc(ctx, 'sawtooth', vary(700))
    o.frequency.exponentialRampToValueAtTime(400, t + 0.25)
    const g = env(ctx, t, 0.01, 0.25, 0.12 * v)
    o.connect(filter(ctx, 'bandpass', 1500, 2)).connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.3)
    return 0.3
  },
  temporal: (ctx, out, t, _e, v) => {
    bell(ctx, out, t, vary(660, 0.05), 0.8, 0.18 * v, 1.5, 300)
    bell(ctx, out, t + 0.05, vary(990, 0.05), 0.7, 0.1 * v, 1.5, 200)
    return 0.9
  },
  gravity: (ctx, out, t, e, v) => {
    const o = osc(ctx, 'sine', 90)
    o.frequency.exponentialRampToValueAtTime(30, t + 0.6)
    const g = env(ctx, t, 0.05, 0.6, 0.6 * v)
    o.connect(g).connect(out)
    o.start(t)
    o.stop(t + 0.7)
    burst(ctx, e, out, t, 'lowpass', 300, 1, 0.6, 0.3 * v, true)
    return 0.7
  },
  explosion: (ctx, out, t, e, v) => {
    thump(ctx, out, t, 110, 28, 0.7, 1 * v)
    burst(ctx, e, out, t, 'lowpass', 1400, 0.6, 0.8, 0.8 * v, true)
    burst(ctx, e, out, t + 0.02, 'bandpass', 2600, 1, 0.25, 0.3 * v)
    return 0.9
  },
  bigExplosion: (ctx, out, t, e, v) => {
    thump(ctx, out, t, 80, 22, 1.4, 1.2 * v)
    burst(ctx, e, out, t, 'lowpass', 900, 0.5, 1.6, 1 * v, true)
    burst(ctx, e, out, t + 0.1, 'lowpass', 300, 0.5, 2, 0.6 * v, true)
    return 2
  },
  hit: (ctx, out, t, e, v) => {
    bell(ctx, out, t, vary(900, 0.2), 0.12, 0.12 * v, 2.3, 300)
    burst(ctx, e, out, t, 'highpass', 3000, 1, 0.04, 0.08 * v)
    return 0.15
  },
  deathSmall: (ctx, out, t, e, v) => {
    bell(ctx, out, t, vary(420, 0.2), 0.25, 0.25 * v, 1.41, 500)
    burst(ctx, e, out, t, 'bandpass', 1600, 1.5, 0.15, 0.3 * v)
    return 0.3
  },
  deathLarge: (ctx, out, t, e, v) => {
    RECIPES.explosion(ctx, out, t, e, v)
    bell(ctx, out, t + 0.05, vary(160, 0.1), 0.8, 0.3 * v, 1.41, 600)
    return 0.9
  },
  build: (ctx, out, t, e, v) => {
    for (let i = 0; i < 4; i++) burst(ctx, e, out, t + i * 0.05, 'bandpass', 2200, 6, 0.02, 0.3 * v)
    thump(ctx, out, t + 0.22, 160, 60, 0.18, 0.7 * v)
    bell(ctx, out, t + 0.22, 330, 0.4, 0.15 * v, 2.76, 250)
    return 0.6
  },
  upgrade: (ctx, out, t, _e, v) => {
    ;[523, 659, 784, 1046].forEach((f, i) => bell(ctx, out, t + i * 0.07, f, 0.5, 0.14 * v, 2, 120))
    return 0.8
  },
  sell: (ctx, out, t, _e, v) => {
    ;[1318, 1568, 1318].forEach((f, i) => bell(ctx, out, t + i * 0.06, f, 0.2, 0.12 * v, 3, 150))
    return 0.4
  },
  coin: (ctx, out, t, _e, v) => {
    bell(ctx, out, t, vary(1760, 0.03), 0.15, 0.06 * v, 3.2, 200)
    return 0.2
  },
  alarm: (ctx, out, t, _e, v) => {
    for (let i = 0; i < 2; i++) {
      const o = osc(ctx, 'square', i % 2 ? 660 : 880)
      const g = env(ctx, t + i * 0.18, 0.01, 0.16, 0.12 * v)
      o.connect(filter(ctx, 'lowpass', 2200)).connect(g).connect(out)
      o.start(t + i * 0.18)
      o.stop(t + i * 0.18 + 0.2)
    }
    return 0.4
  },
  horn: (ctx, out, t, _e, v) => {
    // A brass fanfare chord announcing a wave.
    ;[146.8, 220, 293.7].forEach((f) => {
      const o = osc(ctx, 'sawtooth', f)
      const f2 = filter(ctx, 'lowpass', 400)
      f2.frequency.setValueAtTime(400, t)
      f2.frequency.linearRampToValueAtTime(1800, t + 0.25)
      f2.frequency.linearRampToValueAtTime(700, t + 1.1)
      const g = env(ctx, t, 0.08, 1.1, 0.1 * v, 0.02)
      o.connect(f2).connect(g).connect(out)
      o.start(t)
      o.stop(t + 1.3)
    })
    return 1.3
  },
  gong: (ctx, out, t, _e, v) => {
    bell(ctx, out, t, 73.4, 3, 0.6 * v, 1.4, 800)
    bell(ctx, out, t, 110, 2.5, 0.25 * v, 2.1, 400)
    return 3
  },
  whoosh: (ctx, out, t, e, v) => {
    const n = noiseSource(ctx, e, true)
    const f = filter(ctx, 'bandpass', 300, 1.5)
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.5)
    const g = env(ctx, t, 0.2, 0.5, 0.5 * v)
    n.connect(f).connect(g).connect(out)
    n.start(t)
    n.stop(t + 0.8)
    return 0.8
  },
  click: (ctx, out, t, e, v) => {
    burst(ctx, e, out, t, 'bandpass', 3500, 5, 0.02, 0.25 * v)
    return 0.05
  },
  victory: (ctx, out, t, _e, v) => {
    ;[293.7, 370, 440, 587.3].forEach((f, i) => brassNote(ctx, out, t + i * 0.18, v * 0.9, f))
    return 1.8
  },
  defeat: (ctx, out, t, _e, v) => {
    ;[293.7, 277.2, 261.6, 196].forEach((f, i) => brassNote(ctx, out, t + i * 0.35, v * 0.8, f))
    return 2.2
  },
}


export interface PlayOptions {
  bus?: Bus
  volume?: number
  /** Stereo position -1 (left) … 1 (right). */
  pan?: number
  cooldown?: number
  maxConcurrent?: number
  delay?: number
}

/** Plays a recipe (or its manifest sample) with voice limiting and stereo placement. */
export function play(id: string, o: PlayOptions = {}): void {
  const engine = AudioEngine.get()
  const ctx = engine.ctx
  if (!ctx || ctx.state !== 'running') return
  const recipe = RECIPES[id]
  if (!recipe) return
  const release = engine.admit(id, o.cooldown ?? 0.03, o.maxConcurrent ?? 6, 1)
  if (!release) return
  const panner = ctx.createStereoPanner()
  panner.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0))
  panner.connect(engine.bus(o.bus ?? 'sfx'))
  const t = ctx.currentTime + (o.delay ?? 0)
  const synthesize = () => {
    const length = recipe(ctx, panner, t, engine, o.volume ?? 1)
    window.setTimeout(() => panner.disconnect(), (length + (o.delay ?? 0)) * 1000 + 200)
  }
  if (!AUDIO_MANIFEST[id]) {
    synthesize()
    return
  }
  void engine.sample(id).then((buffer) => {
    if (buffer) {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const g = ctx.createGain()
      g.gain.value = o.volume ?? 1
      src.connect(g).connect(panner)
      src.start(t)
      src.onended = () => panner.disconnect()
      return
    }
    synthesize()
  })
}
