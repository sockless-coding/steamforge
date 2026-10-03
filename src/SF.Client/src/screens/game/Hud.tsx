import { useEffect, useState } from 'react'
import { useLoadedContent } from '../../api/content'
import type { BuildingCategory, BuildingDef } from '../../api/types'
import type { GameController } from '../../game/GameController'
import { useHud, type AirInfo, type GuildPetitionInfo, type GuildRow, type HudState, type PetitionInfo, type Tool } from '../../state/game'
import { useSettings } from '../../state/settings'
import { Button } from '../../ui/components'
import { Icon, type IconName } from '../../ui/Icon'
import { GameMenu, GuildPanel, Outcome, StoresPanel } from './Panels'
import { ChartPanel, FinaleCard } from './Chart'
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

/** A tiny brass pressure dial: the needle shows load (drawn over supplied), red past full. */
function MiniDial({ load, color }: { load: number; color: string }) {
  const point = (deg: number, r: number) => [13 + r * Math.sin((deg * Math.PI) / 180), 14 - r * Math.cos((deg * Math.PI) / 180)]
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from, 9)
    const [x2, y2] = point(to, 9)
    return `M ${x1} ${y1} A 9 9 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }
  const [nx, ny] = point((Math.min(1.5, Math.max(0, load)) / 1.5) * 240 - 120, 8)
  return (
    <svg className="mini-dial" viewBox="0 0 26 26" width={24} height={24} aria-hidden="true">
      <circle cx="13" cy="14" r="11.5" fill="#1c1612" stroke="var(--brass)" strokeWidth="1.6" />
      <path d={arc(-120, 40)} stroke={color} strokeWidth="2" fill="none" opacity="0.75" />
      <path d={arc(40, 120)} stroke="var(--danger)" strokeWidth="2" fill="none" />
      <line x1="13" y1="14" x2={nx} y2={ny} stroke="var(--parchment)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="13" cy="14" r="1.8" fill="var(--brass-hi)" />
    </svg>
  )
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/**
 * The soot barometer and wind vane: a smoked-glass dial whose needle shows the smoke at the colony's homes (red past
 * the point where lungs suffer), beside a brass vane pointing where the wind carries the smoke. Toggles the soot map.
 */
function AirChip({ air, onToggle }: { air: AirInfo; onToggle: () => void }) {
  const point = (deg: number, r: number) => [13 + r * Math.sin((deg * Math.PI) / 180), 14 - r * Math.cos((deg * Math.PI) / 180)]
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from, 9)
    const [x2, y2] = point(to, 9)
    return `M ${x1} ${y1} A 9 9 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
  }
  const angle = (v: number) => Math.min(1, Math.max(0, v)) * 240 - 120
  const [nx, ny] = point(angle(air.homes), 8)
  const [wx, wy] = point(angle(air.worst), 9.5)
  const bad = air.homes > air.safe
  const label = air.homes < 0.05 ? 'Clean' : air.homes < air.safe ? 'Hazy' : air.homes < 0.6 ? 'Smoky' : 'Choking'
  // The vane points downwind: where the smoke is going.
  const towards = (air.windFrom + 180) % 360
  const from = COMPASS[Math.round(air.windFrom / 45) % 8]
  const title =
    `Air at the homes: ${label.toLowerCase()} (${Math.round(air.homes * 100)}% soot, worst home ${Math.round(air.worst * 100)}%). ` +
    `Wind from the ${from}, carrying smoke ${COMPASS[Math.round(towards / 45) % 8]}. Click to ${air.view ? 'hide' : 'show'} the soot map.`
  return (
    <button type="button" className={`gauge-chip air-chip ${bad ? 'short' : ''} ${air.view ? 'active' : ''}`} onClick={onToggle} title={title}>
      <svg className="mini-dial" viewBox="0 0 26 26" width={24} height={24} aria-hidden="true">
        <circle cx="13" cy="14" r="11.5" fill="#1c1612" stroke="var(--brass)" strokeWidth="1.6" />
        <path d={arc(-120, angle(air.safe))} stroke="#8aa07a" strokeWidth="2" fill="none" opacity="0.8" />
        <path d={arc(angle(air.safe), 120)} stroke="var(--danger)" strokeWidth="2" fill="none" />
        <circle cx={wx} cy={wy} r="1.2" fill="var(--ember)" />
        <line x1="13" y1="14" x2={nx} y2={ny} stroke="var(--parchment)" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="13" cy="14" r="1.8" fill="var(--brass-hi)" />
      </svg>
      <svg className="wind-vane" viewBox="0 0 24 24" width={20} height={20} aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--brass-lo)" strokeWidth="1" />
        <g transform={`rotate(${towards} 12 12)`}>
          <path d="M12 3 L15 9 L12.9 8.4 L12.9 19 L11.1 19 L11.1 8.4 L9 9 Z" fill="var(--brass-hi)" />
          <path d="M9.5 19 L14.5 19 L12 16.5 Z" fill="var(--brass)" />
        </g>
      </svg>
      <span className="gauge-text">
        <b>{label}</b>
      </span>
    </button>
  )
}

const MOOD_LABEL: Record<GuildRow['mood'], string> = {
  proud: 'Proud',
  content: 'Content',
  grumbling: 'Grumbling',
  workToRule: 'Working to rule',
  striking: 'On strike',
}

/** A guild's enamel badge: a shield in its colours bearing its standing, with an arrow for where it is heading. */
function GuildBadge({ guild }: { guild: GuildRow }) {
  const trend = guild.target > guild.standing + 2 ? 'up' : guild.target < guild.standing - 2 ? 'down' : ''
  return (
    <span
      className={`guild-badge mood-${guild.mood}`}
      title={`${guild.name}: ${MOOD_LABEL[guild.mood].toLowerCase()}, standing ${Math.round(guild.standing)}${trend ? `, heading for ${Math.round(guild.target)}` : ''}. ${guild.members} members.`}
    >
      <svg viewBox="0 0 22 24" width={21} height={23} aria-hidden="true">
        <path d="M2 2 H20 V12 C20 17 16 20.5 11 22.5 C6 20.5 2 17 2 12 Z" fill={guild.color} stroke="var(--brass-hi)" strokeWidth="1.3" />
        <text x="11" y="15" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1c1612">
          {Math.round(guild.standing)}
        </text>
        {trend && <path d={trend === 'up' ? 'M17 3.5 L19.5 7 H14.5 Z' : 'M17 7 L19.5 3.5 H14.5 Z'} className={`trend ${trend}`} />}
      </svg>
    </span>
  )
}

type PanelKind = { kind: 'chart' } | { kind: 'guild' } | { kind: 'stores' } | { kind: 'research' } | { kind: 'dispatches'; letter?: string }

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
          WASD pan · Q/E rotate · wheel zoom · right-drag pan · Space pause · 1–5 speed · R rotate building · Esc cancel
        </div>
      )}
      {panel?.kind === 'guild' && <GuildPanel hud={hud} controller={controller} onClose={close} />}
      {panel?.kind === 'chart' && hud.saga && <ChartPanel hud={hud} controller={controller} onClose={close} />}
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
          <span
            className={`clock ${hud.night ? 'night' : ''}`}
            title={hud.night ? 'Night: citizens sleep, except at workplaces and building sites in lamplight' : 'Daytime'}
          >
            <Icon name={hud.night ? 'moon' : 'sun'} size={15} />
            {hud.timeOfDay}
          </span>
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
          {p.automatons > 0 && (
            <em className="automatons" title="Clockwork automatons">
              <Icon name="gear" size={12} /> {p.automatons}
            </em>
          )}
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
            const load = n.supply > 0 ? n.demand / n.supply : n.demand > 0 ? 1.5 : 0
            return (
              <span key={n.id} className={`gauge-chip ${short ? 'short' : ''}`} title={`${n.name}: ${Math.round(n.supply)} ${n.unit} supplied, ${Math.round(n.demand)} ${n.unit} drawn`}>
                <MiniDial load={load} color={n.color} />
                <span className="gauge-text">
                  <b>{Math.round(n.demand)}</b>
                  <span className="muted">/{Math.round(n.supply)}</span>
                  <small>{n.unit}</small>
                </span>
              </span>
            )
          })}
        <AirChip air={hud.air} onToggle={() => controller.toggleSootView()} />
        {(hud.hasMast || hud.credit > 0) && (
          <button type="button" className="gauge-chip credit-chip" onClick={() => open({ kind: 'stores' })} title="Company credit (airship trade orders are in the Stores panel)">
            <Icon name="coin" size={15} />
            <b>{Math.floor(hud.credit)}</b>
          </button>
        )}
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
        {hud.saga && (
          <Button
            size="sm"
            variant="iron"
            icon="map"
            className={hud.saga.forges.some((f) => f.request) ? 'chart-alerting' : ''}
            onClick={() => open({ kind: 'chart' })}
            title="The Hollowmere chart: the other forges, telegrams and expeditions"
            aria-label="Hollowmere chart"
          />
        )}
        <Button size="sm" variant="iron" icon="book" onClick={() => open({ kind: 'dispatches' })} title="Dispatches from the Company" aria-label="Dispatches" />
        {hud.guilds.length > 0 ? (
          <button type="button" className="guild-badges" onClick={() => open({ kind: 'guild' })} title="Guilds and professions">
            {hud.guilds.map((g) => (
              <GuildBadge key={g.id} guild={g} />
            ))}
          </button>
        ) : (
          <Button size="sm" variant="iron" icon="people" onClick={() => open({ kind: 'guild' })} title="Professions">
            Guild
          </Button>
        )}
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
  // A petition's notice is answered on its card while the travellers wait; the answer gets a notice of its own.
  const recent = hud.notices.filter((n) => n.level !== 'petition').slice(-6).reverse()
  return (
    <ul className="notices">
      {hud.petition && <PetitionCard petition={hud.petition} controller={controller} />}
      {hud.guildPetition && <GuildPetitionCard petition={hud.guildPetition} controller={controller} />}
      {hud.saga?.finale && <FinaleCard finale={hud.saga.finale} controller={controller} />}
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

function GuildPetitionCard({ petition: p, controller }: { petition: GuildPetitionInfo; controller: GameController }) {
  return (
    <li className="petition-card guild-petition" style={{ borderColor: p.color }}>
      <div className="petition-head">
        <i className="guild-dot" style={{ background: p.color }} />
        <b>{p.title}</b>
      </div>
      <p className="petition-text">
        <em>{p.guild}:</em> {p.text}
      </p>
      <div className="petition-patience" title="How long they will wait before taking silence as a refusal">
        <span style={{ width: `${Math.max(0, Math.min(1, p.patience)) * 100}%` }} />
      </div>
      <div className="petition-actions">
        {p.choices.map((label, i) => (
          <Button key={label} size="sm" variant={i === p.choices.length - 1 ? 'iron' : undefined} onClick={() => controller.perform({ type: 'answerGuildPetition', choice: i })}>
            {label}
          </Button>
        ))}
      </div>
    </li>
  )
}

function PetitionCard({ petition: p, controller }: { petition: PetitionInfo; controller: GameController }) {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const who = [plural(p.adults, 'adult', 'adults'), p.children > 0 ? plural(p.children, 'child', 'children') : null].filter(Boolean).join(' and ')
  return (
    <li className="petition-card">
      <div className="petition-head">
        <Icon name="people" size={16} />
        <b>Travellers at the gate</b>
      </div>
      <p>
        {who} ({plural(p.families, 'household', 'households')}) ask to join the colony. They bring no tools.
        {p.feverish && <em className="petition-fever"> Some of them are coughing: they would bring fever.</em>}
      </p>
      <div className="petition-patience" title="How long they will wait for an answer">
        <span style={{ width: `${Math.max(0, Math.min(1, p.patience)) * 100}%` }} />
      </div>
      <div className="petition-actions">
        <Button size="sm" icon="check" onClick={() => controller.perform({ type: 'answerPetition', accept: true })}>
          Welcome them
        </Button>
        <Button size="sm" variant="iron" icon="close" onClick={() => controller.perform({ type: 'answerPetition', accept: false })}>
          Turn away
        </Button>
      </div>
    </li>
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
  // Each grade of conduit is its own tool; laying a better grade over an existing conduit upgrades it.
  const conduitTools: ToolCard[] = content.bundle.rules.networks.flatMap((n) => [
    ...[n.conduit, ...(n.upgrades ?? [])].map((grade, g) => ({
      tool: (g === 0 ? { kind: 'conduit', network: n.id } : { kind: 'conduit', network: n.id, grade: grade.id }) as Tool,
      label: grade.name,
      icon: 'wrench' as IconName,
      detail: `${grade.description} Costs ${Object.entries(grade.cost).map(([r, q]) => `${q} ${names(r).toLowerCase()}`).join(', ')} per tile.`,
      lock: g === 0 ? hud.locks[`network:${n.id}`] : hud.locks[`conduit:${grade.id}`],
    })),
    { tool: { kind: 'removeConduit', network: n.id } as Tool, label: `Remove ${n.name}`, icon: 'close' as IconName, detail: `Drag over ${n.name.toLowerCase()} conduits to remove them.`, lock: hud.locks[`network:${n.id}`] },
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
