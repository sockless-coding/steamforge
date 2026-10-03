import { emitterLoad, sootExposure, type EmitterConfig, type ScrubberConfig } from '../soot'
import { registerComponent } from './registry'

/** Chimneys: the soot system reads this config each second (see soot.ts). */
registerComponent<EmitterConfig>({
  kind: 'emitter',
  describe: (sim, b, cfg) => {
    const load = emitterLoad(sim, b)
    const stack = cfg.stack ? `, ${cfg.stack}-tile stack` : ''
    return [
      load > 0 ? `Smoking: ${(cfg.soot * load * (sim.mods.sootRate ?? 1)).toFixed(1)} soot/s${stack}` : `Chimney cold${stack}`,
      `Air here: ${Math.round(sootExposure(sim, b.x + b.w / 2, b.y + b.h / 2) * 100)}% soot`,
    ]
  },
})

/** Galvanic precipitators: clean the air around them while powered (see soot.ts). */
registerComponent<ScrubberConfig>({
  kind: 'scrubber',
  describe: (sim, b, cfg) => {
    const power = (b.data.power as number | undefined) ?? 0
    return [
      power > 0 ? `Clearing ${Math.round(cfg.rate * power * 100)}% of the soot within ${cfg.radius} tiles each second` : 'Idle: needs power',
      `Air here: ${Math.round(sootExposure(sim, b.x + b.w / 2, b.y + b.h / 2) * 100)}% soot`,
    ]
  },
})
