import { useState } from 'react'
import { useLoadedContent } from '../../api/content'
import type { BuildingCategory, BuildingDef } from '../../api/types'
import type { GameController } from '../../game/GameController'
import { useHud, type HudState, type Tool } from '../../state/game'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/components'
import { Icon, type IconName } from '../../ui/Icon'
import { GameMenu, GuildPanel, Outcome, StoresPanel } from './Panels'
import { Inspector } from './Inspector'

interface HudProps {
  controller: GameController
  menu: boolean
  setMenu: (open: boolean) => void
}

const CATEGORIES: { id: BuildingCategory | 'tools'; label: string; icon: IconName }[] = [
  { id: 'housing', label: 'Housing', icon: 'home' },
  { id: 'food', label: 'Food', icon: 'wheat' },
  { id: 'resources', label: 'Resources', icon: 'pickaxe' },
  { id: 'industry', label: 'Industry', icon: 'factory' },
  { id: 'storage', label: 'Storage', icon: 'box' },
  { id: 'civic', label: 'Civic', icon: 'flag' },
  { id: 'tools', label: 'Roads & Land', icon: 'road' },
]

const SEASON_ICON: Record<string, IconName> = { Spring: 'tree', Summer: 'star', Autumn: 'wheat', Winter: 'snow' }

export function Hud({ controller, menu, setMenu }: HudProps) {
  const hud = useHud()
  const showHints = useSettings((s) => s.settings.showHints)
  const [panel, setPanel] = useState<'guild' | 'stores' | null>(null)

  return (
    <div className="hud">
      <TopBar hud={hud} controller={controller} onMenu={() => setMenu(true)} onGuild={() => setPanel('guild')} onStores={() => setPanel('stores')} />
      <Notices hud={hud} controller={controller} />
      {hud.selection && <Inspector info={hud.selection} controller={controller} />}
      <BuildBar hud={hud} controller={controller} />
      {hud.paused && (
        <div className="pause-banner">
          <Icon name="pause" size={18} />
          <span>Paused: you can still build, plan and give orders.</span>
          <kbd>Space</kbd>
        </div>
      )}
      {hud.hint && hud.tool.kind !== 'select' && <div className="hint-chip">{hud.hint}</div>}
      {showHints && !hud.paused && hud.tool.kind === 'select' && !hud.selection && (
        <div className="controls-hint muted small">
          WASD pan · Q/E rotate · wheel zoom · right-drag pan · Space pause · 1–4 speed · R rotate building · Esc cancel
        </div>
      )}
      {panel === 'guild' && <GuildPanel hud={hud} controller={controller} onClose={() => setPanel(null)} />}
      {panel === 'stores' && <StoresPanel hud={hud} controller={controller} onClose={() => setPanel(null)} />}
      {menu && <GameMenu controller={controller} onClose={() => setMenu(false)} />}
      {hud.outcome === 'lost' && <Outcome controller={controller} />}
    </div>
  )
}

function TopBar({ hud, controller, onMenu, onGuild, onStores }: { hud: HudState; controller: GameController; onMenu: () => void; onGuild: () => void; onStores: () => void }) {
  const key = ['firewood', 'logs', 'stone', 'iron', 'tools', 'coats']
  const rows = key.map((id) => hud.resources.find((r) => r.id === id)).filter((r) => r !== undefined)
  const p = hud.population
  return (
    <header className="top-bar">
      <div className="top-left">
        <div className="colony-name">
          <b className="engraved">{hud.colonyName}</b>
          <span className="muted small">{hud.difficulty}</span>
        </div>
        <div className="date" title={`${Math.round(hud.monthProgress * 100)}% through the month`}>
          <Icon name={SEASON_ICON[hud.season] ?? 'calendar'} size={18} />
          <div>
            <b>
              {hud.monthName}, Year {hud.year}
            </b>
            <div className="month-bar">
              <span style={{ width: `${hud.monthProgress * 100}%` }} />
            </div>
          </div>
          <span className={`temp ${hud.temperature < 2 ? 'cold' : ''}`}>
            <Icon name="thermometer" size={16} />
            {Math.round(hud.temperature)}°
          </span>
        </div>
      </div>

      <button type="button" className="resource-strip" onClick={onStores} title="Stores and production limits">
        <span className="res" title="Population (homeless)">
          <Icon name="people" size={16} />
          <b>{p.total}</b>
          {p.homeless > 0 && <em className="warn">{p.homeless} homeless</em>}
        </span>
        <span className={`res ${hud.food < p.total * 8 ? 'low' : ''}`} title="Food">
          <Icon name="wheat" size={16} />
          <b>{Math.floor(hud.food)}</b>
        </span>
        {rows.map((r) => (
          <span key={r.id} className={`res ${r.amount < 5 ? 'low' : ''}`} title={r.name}>
            <i className="swatch" style={{ background: r.color }} />
            <span className="res-name">{r.name}</span>
            <b>{Math.floor(r.amount)}</b>
          </span>
        ))}
      </button>

      <div className="top-right">
        <Button size="sm" variant="iron" icon="people" onClick={onGuild} title="Guildhall: professions">
          Guild
        </Button>
        <div className="speed">
          <button type="button" className={`speed-btn ${hud.paused ? 'active' : ''}`} onClick={() => controller.togglePause()} title="Pause (Space)">
            <Icon name={hud.paused ? 'play' : 'pause'} size={16} />
          </button>
          {hud.speeds.map((s, i) => (
            <button key={s} type="button" className={`speed-btn ${!hud.paused && hud.speed === i ? 'active' : ''}`} onClick={() => controller.setSpeed(i)} title={`Speed ×${s} (${i + 1})`}>
              ×{s}
            </button>
          ))}
        </div>
        <Button size="sm" variant="iron" icon="menu" onClick={onMenu} aria-label="Menu" />
      </div>
    </header>
  )
}

function Notices({ hud, controller }: { hud: HudState; controller: GameController }) {
  const recent = hud.notices.slice(-6).reverse()
  return (
    <ul className="notices">
      {recent.map((n) => (
        <li key={n.id} className={`notice notice-${n.level}`}>
          <button type="button" onClick={() => n.at !== undefined && controller.focusTile(n.at)} disabled={n.at === undefined}>
            {n.text}
          </button>
        </li>
      ))}
    </ul>
  )
}

function costLabel(def: BuildingDef, names: (id: string) => string): string {
  const parts = Object.entries(def.cost.resources).map(([r, q]) => `${q} ${names(r)}`)
  return parts.length ? parts.join(', ') : 'Free'
}

function sameTool(a: Tool, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function BuildBar({ hud, controller }: { hud: HudState; controller: GameController }) {
  const content = useLoadedContent()
  const [category, setCategory] = useState<BuildingCategory | 'tools' | null>(null)
  const names = (id: string) => content.resources.get(id)?.name ?? id
  const stock = (id: string) => hud.resources.find((r) => r.id === id)?.amount ?? 0
  const buildable = content.bundle.buildings.filter((b) => b.buildable !== false && b.category === category)
  const pick = (tool: Tool) => controller.setTool(sameTool(hud.tool, tool) ? { kind: 'select' } : tool)

  const tools: { tool: Tool; label: string; icon: IconName; detail: string }[] = [
    ...content.bundle.rules.roads.map((r) => ({ tool: { kind: 'road', road: r.id } as Tool, label: r.name, icon: 'road' as IconName, detail: r.description })),
    { tool: { kind: 'removeRoad' }, label: 'Remove Road', icon: 'close', detail: 'Drag over roads to remove them.' },
    { tool: { kind: 'clear' }, label: 'Clear Land', icon: 'axe', detail: 'Drag to mark trees, rocks and bushes for laborers to gather.' },
    { tool: { kind: 'unclear' }, label: 'Unmark', icon: 'minus', detail: 'Drag to cancel clearing orders.' },
    { tool: { kind: 'demolish' }, label: 'Demolish', icon: 'trash', detail: 'Click a building to demolish it (half its materials return).' },
  ]

  return (
    <div className="build-bar">
      {category && (
        <div className="build-tray">
          {category === 'tools'
            ? tools.map((t) => (
                <button key={t.label} type="button" className={`build-card tool-btn ${sameTool(hud.tool, t.tool) ? 'active' : ''}`} onClick={() => pick(t.tool)} title={t.detail}>
                  <Icon name={t.icon} size={22} />
                  <b>{t.label}</b>
                  <span className="muted small">{t.detail}</span>
                </button>
              ))
            : buildable.map((def) => {
                const tool: Tool = { kind: 'build', def: def.id }
                const short = Object.entries(def.cost.resources).some(([r, q]) => stock(r) < q)
                return (
                  <button key={def.id} type="button" className={`build-card ${sameTool(hud.tool, tool) ? 'active' : ''}`} onClick={() => pick(tool)} title={def.description}>
                    <b>{def.name}</b>
                    <span className={`cost ${short ? 'short' : ''}`}>{costLabel(def, names)}</span>
                    <span className="muted small">{def.description}</span>
                  </button>
                )
              })}
        </div>
      )}
      <nav className="build-tabs">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`tab ${category === c.id ? 'tab-active' : ''}`} onClick={() => setCategory(category === c.id ? null : c.id)}>
            <Icon name={c.icon} size={16} />
            {c.label}
          </button>
        ))}
        <span className="build-status muted small">
          {hud.sites > 0 ? `${hud.sites} under construction · ` : ''}
          {hud.builders.count}/{hud.builders.target} builders · {hud.laborers} laborers
        </span>
      </nav>
    </div>
  )
}
