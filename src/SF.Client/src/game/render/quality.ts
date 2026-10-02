import type { QualityTier } from '../../state/settings'

export interface QualityProfile {
  tier: Exclude<QualityTier, 'auto'>
  /** Device pixel ratio cap. */
  resolution: number
  /** Shadow map size, 0 = no shadows. */
  shadows: number
  particles: number
  bloom: boolean
  antialias: boolean
}

export function resolveQuality(tier: QualityTier): QualityProfile {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const resolved = tier === 'auto' ? autoTier() : tier
  switch (resolved) {
    case 'low':
      return { tier: 'low', resolution: 1, shadows: 0, particles: 600, bloom: false, antialias: false }
    case 'medium':
      return { tier: 'medium', resolution: Math.min(dpr, 1.25), shadows: 1024, particles: 1400, bloom: false, antialias: true }
    case 'ultra':
      return { tier: 'ultra', resolution: Math.min(dpr, 2), shadows: 4096, particles: 4000, bloom: true, antialias: true }
    default:
      return { tier: 'high', resolution: Math.min(dpr, 1.75), shadows: 2048, particles: 2600, bloom: true, antialias: true }
  }
}

function autoTier(): Exclude<QualityTier, 'auto'> {
  if (typeof navigator === 'undefined') return 'medium'
  const cores = navigator.hardwareConcurrency ?? 4
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints ?? 0) > 1
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  if (mobile) return cores >= 8 && memory >= 6 ? 'medium' : 'low'
  return cores >= 8 ? 'high' : 'medium'
}

/** Steps quality down when the frame rate stays low, so weak devices converge on something smooth. */
export class FrameGovernor {
  private samples: number[] = []
  private cooldown = 5

  /** Returns true when quality should drop one tier. */
  sample(dt: number): boolean {
    this.cooldown -= dt
    this.samples.push(dt)
    if (this.samples.length > 90) this.samples.shift()
    if (this.cooldown > 0 || this.samples.length < 90) return false
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    if (avg > 1 / 35) {
      this.samples = []
      this.cooldown = 8
      return true
    }
    return false
  }
}

export function lowerTier(tier: QualityProfile['tier']): QualityProfile['tier'] | null {
  return tier === 'ultra' ? 'high' : tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : null
}
