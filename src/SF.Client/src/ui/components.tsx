import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useEffect, useId, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { gearPath } from './gears'
import { Icon, type IconName } from './Icon'

export function Panel({
  children,
  title,
  className = '',
  style,
  variant = 'iron',
}: {
  children: ReactNode
  title?: ReactNode
  className?: string
  style?: CSSProperties
  variant?: 'iron' | 'parchment'
}) {
  return (
    <section className={`panel panel-${variant} ${className}`} style={style}>
      <span className="rivet rivet-tl" />
      <span className="rivet rivet-tr" />
      <span className="rivet rivet-bl" />
      <span className="rivet rivet-br" />
      {title && <header className="panel-title">{title}</header>}
      <div className="panel-body">{children}</div>
    </section>
  )
}

type ButtonVariant = 'brass' | 'iron' | 'copper' | 'danger' | 'ghost'

export function Button({
  variant = 'brass',
  icon,
  children,
  className = '',
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 22 : size === 'sm' ? 15 : 18} />}
      {children && <span>{children}</span>}
    </button>
  )
}

export function Gear({ size, teeth = 12, speed = 30, reverse = false, style, className = '' }: {
  size: number
  teeth?: number
  speed?: number
  reverse?: boolean
  style?: CSSProperties
  className?: string
}) {
  const id = useId()
  const d = useMemo(() => gearPath(teeth, 50, 50 - Math.max(6, 60 / teeth), 18, teeth > 10 ? 5 : 4), [teeth])
  return (
    <svg
      viewBox="-52 -52 104 104"
      width={size}
      height={size}
      className={`gear ${className}`}
      style={{ animationDuration: `${speed}s`, animationDirection: reverse ? 'reverse' : 'normal', ...style }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6d98a" />
          <stop offset="0.45" stopColor="#c8923e" />
          <stop offset="1" stopColor="#5a3812" />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#g${id})`} fillRule="evenodd" stroke="#2a1a0a" strokeWidth="1.2" />
      <circle r="9" fill="none" stroke="#3a2410" strokeWidth="2" opacity="0.6" />
    </svg>
  )
}

export function GearSpinner({ label }: { label?: string }) {
  return (
    <div className="gear-spinner" role="status">
      <div className="gear-spinner-gears">
        <Gear size={64} teeth={12} speed={4} />
        <Gear size={40} teeth={8} speed={2.66} reverse className="gear-spinner-small" />
      </div>
      {label && <p className="muted">{label}</p>}
    </div>
  )
}

/** Animated menu backdrop: interlocking brass gears in the gloom, drifting steam and a warm vignette. */
export function GearBackdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-glow" />
      <Gear size={520} teeth={24} speed={140} className="backdrop-gear" style={{ left: '-160px', top: '-180px' }} />
      <Gear size={300} teeth={14} speed={81.6} reverse className="backdrop-gear" style={{ left: '290px', top: '-40px' }} />
      <Gear size={640} teeth={30} speed={175} className="backdrop-gear" style={{ right: '-260px', bottom: '-300px' }} />
      <Gear size={260} teeth={12} speed={70} reverse className="backdrop-gear" style={{ right: '300px', bottom: '-60px' }} />
      <Gear size={160} teeth={10} speed={58} className="backdrop-gear backdrop-gear-near" style={{ right: '8%', top: '12%' }} />
      <div className="steam steam-1" />
      <div className="steam steam-2" />
      <div className="steam steam-3" />
      <div className="backdrop-vignette" />
    </div>
  )
}

/** Semi-circular pressure gauge used for XP, cores and other meters. */
export function Gauge({ value, max, label, size = 120, color = 'var(--brass-hi)' }: {
  value: number
  max: number
  label?: ReactNode
  size?: number
  color?: string
}) {
  const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const angle = -120 + t * 240
  const ticks = Array.from({ length: 13 }, (_, i) => -120 + i * 20)
  return (
    <div className="gauge" style={{ width: size }}>
      <svg viewBox="-60 -60 120 120" width={size} height={size}>
        <circle r="56" fill="url(#gauge-face)" stroke="#6a4418" strokeWidth="4" />
        <defs>
          <radialGradient id="gauge-face">
            <stop offset="0" stopColor="#efe2c2" />
            <stop offset="1" stopColor="#b9a47a" />
          </radialGradient>
        </defs>
        {ticks.map((a) => (
          <line
            key={a}
            x1="0"
            y1="-46"
            x2="0"
            y2={a % 60 === 0 ? -38 : -42}
            stroke="#3a2a18"
            strokeWidth={a % 60 === 0 ? 2.5 : 1.2}
            transform={`rotate(${a})`}
          />
        ))}
        <path d="M-40,23 A46,46 0 0 0 40,23" fill="none" stroke="#a03020" strokeWidth="3" opacity="0.5" transform="rotate(180)" />
        <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)` }}>
          <path d="M-2.5,6 L0,-44 L2.5,6 Z" fill={color} stroke="#2a1a0a" strokeWidth="1" />
        </g>
        <circle r="6" fill="#6a4418" stroke="#f6d98a" strokeWidth="1.5" />
      </svg>
      {label && <div className="gauge-label">{label}</div>}
    </div>
  )
}

export function ProgressBar({ value, max, color = 'var(--brass)', label }: { value: number; max: number; color?: string; label?: ReactNode }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      {label && <span className="progress-label">{label}</span>}
    </div>
  )
}

export function Modal({ children, onClose, title, wide = false }: { children: ReactNode; onClose: () => void; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <Panel title={title}>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
          {children}
        </Panel>
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; icon?: IconName }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`tab ${tab.id === value ? 'tab-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon && <Icon name={tab.icon} size={16} />}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function ScreenHeader({ title, back = '/', right }: { title: ReactNode; back?: string | null; right?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <header className="screen-header">
      {back !== null ? (
        <Button variant="iron" icon="back" size="sm" onClick={() => navigate(back)} aria-label="Back" />
      ) : (
        <span />
      )}
      <h1 className="engraved screen-title">{title}</h1>
      <div className="screen-header-right">{right}</div>
    </header>
  )
}

export function Stat({ icon, value, label, color }: { icon: IconName; value: ReactNode; label?: string; color?: string }) {
  return (
    <span className="stat" title={label} style={color ? { color } : undefined}>
      <Icon name={icon} size={16} />
      <b>{value}</b>
    </span>
  )
}

export function Divider() {
  return (
    <div className="divider" aria-hidden="true">
      <span />
      <Gear size={18} teeth={8} speed={0} />
      <span />
    </div>
  )
}
