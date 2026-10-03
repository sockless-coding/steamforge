import { useEffect, useState } from 'react'
import { useLoadedContent } from '../../api/content'
import type { BuildingCategory, BuildingDef } from '../../api/types'
import type { GameController } from '../../game/GameController'
import { useHud, type HudState, type Tool } from '../../state/game'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/components'
import { Icon, type IconName } from '../../ui/Icon'
import { GameMenu, GuildPanel, Outcome, StoresPanel } from './Panels'
import { Inspector } from './Inspector'
import { Charter, DispatchPanel, ResearchPanel } from './Progression'

interface HudProps {
  controller: GameController
  menu: boolean
  setMenu: (open: boolean) => void
}

type Category = BuildingCategory | 'tools'

const CATEGORIES: { id: Category; label: string; icon: IconName }[] = [
  { id: 'housing', label: 'Housing', icon: 'home' },
  { id: 'food', label: 'Food', icon: 'wheat' },
  { id: 'resources', label: 'Resources', icon: 'pickaxe' },
  { id: 'industry', label: 'Industry', icon: 'factory' },
  { id: 'power', label: 'Steam & Power', icon: 'bolt' },
  { id: 'science', label: 'Science', icon: 'flask' },
  { id: 'storage', label: 'Storage', icon: 'box' },
  { id: 'civic', label: 'Civic', icon: 'flag' },
  { id: 'tools', label: 'Roads & Land', icon: 'road' },
]

const SEASON_ICON: Record<string, IconName> = { Spring: 'tree', Summer: 'star', Autumn: 'wheat', Winter: 'snow' }

type PanelKind = { kind: 'guild' } | { kind: 'stores' } | { kind: 'research' } | { kind: 'dispatches'; letter?: string }

export function Hud({ controller, menu, setMenu }: HudProps) {
  const hud = useHud()
  const showHints = useSettings((s) => s.settings.showHints)
  const [panel, setPanel] = useState<PanelKind | null>(null)
  // A freshly founded colony opens with the Company's charter; time waits until it is read.
  const [charter, setCharter] = useState(() => controller.sim.tick === 0)
  useEffect(() => {
    if (charter) controller.setPaused(true)
  }, [charter, controller])

  const close = () => setPanel(null)
  return (
    <div className="hud">
      <TopBar hud={hud} controller={controller} onMenu={() => setMenu(true)} open={setPanel} />
      <Notices hud={hud} controller={controller} openLetter={(letter) => setPanel({ kind: 'dispatches', letter })} />
      {hud.selection && <Inspector info={hud.selection} controller={controller} />}
      <BuildBar hud={hud} controller={controller} />
      {hud.paused && !charter && (
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
      {panel?.kind === 'guild' && <GuildPanel hud={hud} controller={controller} onClose={close} />}
      {panel?.kind === 'stores' && <StoresPanel hud={hud} controller={controller} onClose={close} />}
      {panel?.kind === 'research' && <ResearchPanel hud={hud} controller={controller} onClose={close} />}
      {panel?.kind === 'dispatches' && <DispatchPanel hud={hud} initial={panel.letter} onClose={close} />}
      {menu && <GameMenu controller={controller} onClose={() => setMenu(false)} />}
      {charter && (
        <Charter
          hud={hud}
          onClose={() => {
            setCharter(false)
            controller.setPaused(false)
          }}
        />
      )}
      {hud.outcome === 'lost' && <Outcome controller={controller} />}
    </div>
  )
}

function TopBar({ hud, controller, onMenu, open }: { hud: HudState; controller: GameController; onMenu: () => void; open: (p: PanelKind) => void }) {
  const key = ['firewood', 'logs', 'stone', 'iron', 'copper', 'tools', 'coats']
  // Copper only earns its place once the colony has some.
  const rows = key.map((id) => hud.resources.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => r !== undefined && (r.id !== 'copper' || r.amount > 0))
  const p = hud.population
  const r = hud.researching
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

      <button type="button" className="resource-strip" onClick={() => open({ kind: 'stores' })} title="Stores and production limits">
        <span className="res" title="Population (homeless)">
          <Icon name="people" size={16} />
          <b>{p.total}</b>
          {p.homeless > 0 && <em className="warn">{p.homeless} homeless</em>}
        </span>
        <span className={`res ${hud.food < p.total * 8 ? 'low' : ''}`} title="Food">
          <Icon name="wheat" size={16} />
          <b>{Math.floor(hud.food)}</b>
        </span>
        {rows.map((res) => (
          <span key={res.id} className={`res ${res.amount < 5 ? 'low' : ''}`} title={res.name}>
            <i className="swatch" style={{ background: res.color }} />
            <span className="res-name">{res.name}</span>
            <b>{Math.floor(res.amount)}</b>
          </span>
        ))}
      </button>

      <div className="energy-strip">
        {hud.networks
          .filter((n) => n.active)
          .map((n) => {
            const short = n.demand > n.supply + 1e-6
            return (
              <span key={n.id} className={`gauge-chip ${short ? 'short' : ''}`} title={`${n.name}: ${Math.round(n.supply)} ${n.unit} supplied, ${Math.round(n.demand)} ${n.unit} drawn`}>
                <Icon name="bolt" size={14} style={{ color: n.color }} />
                <b>{Math.round(n.demand)}</b>
                <span className="muted">/{Math.round(n.supply)}</span>
              </span>
            )
          })}
        <button type="button" className={`research-chip ${r ? '' : 'idle'}`} onClick={() => open({ kind: 'research' })} title="Research (Drafting Office)">
          <Icon name="flask" size={15} />
          {r ? (
            <span className="research-chip-body">
              <span className="research-chip-name">{r.name}</span>
              <span className="month-bar">
                <span style={{ width: `${(r.progress / r.points) * 100}%` }} />
              </span>
            </span>
          ) : (
            <span className="research-chip-name">Choose research</span>
          )}
        </button>
      </div>

      <div className="top-right">
        <Button size="sm" variant="iron" icon="book" onClick={() => open({ kind: 'dispatches' })} title="Dispatches from the Company" aria-label="Dispatches" />
        <Button size="sm" variant="iron" icon="people" onClick={() => open({ kind: 'guild' })} title="Professions">
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

function Notices({ hud, controller, openLetter }: { hud: HudState; controller: GameController; openLetter: (id: string) => void }) {
  const recent = hud.notices.slice(-6).reverse()
  return (
    <ul className="notices">
      {recent.map((n) => (
        <li key={n.id} className={`notice notice-${n.level}`}>
          {n.dispatch ? (
            <button type="button" onClick={() => openLetter(n.dispatch!)}>
              <Icon name="book" size={14} /> {n.text} <span className="muted">(read)</span>
            </button>
          ) : (
            <button type="button" onClick={() => n.at !== undefined && controller.focusTile(n.at)} disabled={n.at === undefined}>
              {n.text}
            </button>
          )}
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

interface ToolCard {
  tool: Tool
  label: string
  icon: IconName
  detail: string
  /** Research still needed, if any. */
  lock?: string
}

function BuildBar({ hud, controller }: { hud: HudState; controller: GameController }) {
  const content = useLoadedContent()
  const [category, setCategory] = useState<Category | null>(null)
  const names = (id: string) => content.resources.get(id)?.name ?? id
  const stock = (id: string) => hud.resources.find((r) => r.id === id)?.amount ?? 0
  const buildable = content.bundle.buildings.filter((b) => b.buildable !== false && b.category === category)
  const pick = (tool: Tool) => controller.setTool(sameTool(hud.tool, tool) ? { kind: 'select' } : tool)

  const landTools: ToolCard[] = [
    ...content.bundle.rules.roads.map((r) => ({ tool: { kind: 'road', road: r.id } as Tool, label: r.name, icon: 'road' as IconName, detail: r.description, lock: hud.locks[`road:${r.id}`] })),
    { tool: { kind: 'removeRoad' }, label: 'Remove Road', icon: 'close', detail: 'Drag over roads to remove them.' },
    { tool: { kind: 'clear' }, label: 'Clear Land', icon: 'axe', detail: 'Drag to mark trees, rocks and bushes for laborers to gather.' },
    { tool: { kind: 'unclear' }, label: 'Unmark', icon: 'minus', detail: 'Drag to cancel clearing orders.' },
    { tool: { kind: 'demolish' }, label: 'Demolish', icon: 'trash', detail: 'Click a building to demolish it (half its materials return).' },
  ]
  const conduitTools: ToolCard[] = content.bundle.rules.networks.flatMap((n) => [
    {
      tool: { kind: 'conduit', network: n.id } as Tool,
      label: n.conduit.name,
      icon: 'wrench' as IconName,
      detail: `${n.conduit.description} Costs ${Object.entries(n.conduit.cost).map(([r, q]) => `${q} ${names(r).toLowerCase()}`).join(', ')} per tile.`,
      lock: hud.locks[`network:${n.id}`],
    },
    { tool: { kind: 'removeConduit', network: n.id } as Tool, label: `Remove ${n.conduit.name}`, icon: 'close' as IconName, detail: `Drag over ${n.conduit.name.toLowerCase()}s to remove them.`, lock: hud.locks[`network:${n.id}`] },
  ])
  const tools = category === 'tools' ? landTools : category === 'power' ? conduitTools : []

  return (
    <div className="build-bar">
      {category && (
        <div className="build-tray">
          {tools.map((t) => (
            <button
              key={t.label}
              type="button"
              className={`build-card tool-btn ${sameTool(hud.tool, t.tool) ? 'active' : ''} ${t.lock ? 'locked' : ''}`}
              onClick={() => pick(t.tool)}
              title={t.detail}
            >
              <Icon name={t.lock ? 'lock' : t.icon} size={22} />
              <b>{t.label}</b>
              {t.lock ? <span className="cost short">Research {t.lock}</span> : <span className="muted small">{t.detail}</span>}
            </button>
          ))}
          {buildable.map((def) => {
            const tool: Tool = { kind: 'build', def: def.id }
            const lock = hud.locks[`building:${def.id}`]
            const short = Object.entries(def.cost.resources).some(([r, q]) => stock(r) < q)
            return (
              <button
                key={def.id}
                type="button"
                className={`build-card ${sameTool(hud.tool, tool) ? 'active' : ''} ${lock ? 'locked' : ''}`}
                onClick={() => pick(tool)}
                title={def.description}
              >
                <b>
                  {lock && <Icon name="lock" size={13} />} {def.name}
                </b>
                {lock ? <span className="cost short">Research {lock}</span> : <span className={`cost ${short ? 'short' : ''}`}>{costLabel(def, names)}</span>}
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
