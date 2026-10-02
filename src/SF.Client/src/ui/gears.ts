/** Builds an SVG path for a spur gear centred on the origin, with trapezoidal teeth and an optional spoked hub. */
export function gearPath(teeth: number, outer: number, inner: number, hub = 0, spokes = 0): string {
  const steps = teeth * 4
  const points: string[] = []
  for (let i = 0; i < steps; i++) {
    const angle = (Math.PI * 2 * i) / steps - Math.PI / 2
    const phase = i % 4
    const radius = phase === 1 || phase === 2 ? outer : inner
    // Narrow the tooth tips slightly for a machined look.
    const tweak = phase === 1 ? 0.18 : phase === 2 ? -0.18 : 0
    const a = angle + (tweak * Math.PI * 2) / steps
    points.push(`${(Math.cos(a) * radius).toFixed(2)},${(Math.sin(a) * radius).toFixed(2)}`)
  }

  let d = `M${points.join('L')}Z`
  if (hub > 0) {
    // Cut-out ring between hub and rim, bridged by spokes (evenodd fill makes these holes).
    const rimInner = inner * 0.78
    if (spokes > 0) {
      const spokeHalf = (Math.PI / spokes) * 0.28
      for (let s = 0; s < spokes; s++) {
        const a0 = (Math.PI * 2 * s) / spokes + spokeHalf
        const a1 = (Math.PI * 2 * (s + 1)) / spokes - spokeHalf
        d += `M${arcPoint(hub * 1.25, a0)}A${hub * 1.25},${hub * 1.25} 0 0 1 ${arcPoint(hub * 1.25, a1)}L${arcPoint(rimInner, a1)}A${rimInner},${rimInner} 0 0 0 ${arcPoint(rimInner, a0)}Z`
      }
    }
    d += `M${hub * 0.45},0A${hub * 0.45},${hub * 0.45} 0 1 0 ${-hub * 0.45},0A${hub * 0.45},${hub * 0.45} 0 1 0 ${hub * 0.45},0Z`
  }
  return d
}

function arcPoint(r: number, a: number): string {
  return `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`
}
