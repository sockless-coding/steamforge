/**
 * Mulberry32. The simulation must never call Math.random: every random choice flows from the colony seed, and the
 * generator state is part of every save so a loaded colony continues exactly as it would have.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** Serializable generator state. */
  get state32(): number {
    return this.state
  }

  set state32(value: number) {
    this.state = value >>> 0
  }

  nextUint(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  next(): number {
    return this.nextUint() / 4294967296
  }

  int(maxExclusive: number): number {
    return maxExclusive <= 0 ? 0 : Math.floor(this.next() * maxExclusive)
  }

  chance(p: number): boolean {
    return p > 0 && this.next() < p
  }

  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(items.length)]
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Picks an index with probability proportional to its weight; -1 when every weight is zero. */
  weighted(weights: readonly number[]): number {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return -1
    let roll = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i])
      if (roll < 0) return i
    }
    return weights.length - 1
  }
}

/** FNV-1a 32-bit over UTF-16 code units: turns a typed seed phrase into a numeric seed. */
export function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}
