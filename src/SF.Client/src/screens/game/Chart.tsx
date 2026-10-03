import { useState } from 'react'
import type { GameController } from '../../game/GameController'
import type { ForgeRow, HudState, SagaInfo } from '../../state/game'
import { Button, Modal } from '../../ui/components'

const FATE_COLOR: Record<string, string> = {
  Answering: '#4f8a46',
  Frozen: '#4a7aa0',
  Overpressure: '#a8402a',
  Revolt: '#c0762a',
  Abandoned: '#7a6448',
}

function markerColor(f: ForgeRow): string {
  if (f.status === 'answering') return FATE_COLOR.Answering
  if (f.fate) return FATE_COLOR[f.fate] ?? '#6a5a48'
  return '#6a5a48'
}

/** Where the expedition airship is on its route: out to the forge for the first half, home for the second. */
function shipAt(f: ForgeRow): [number, number] | null {
  if (!f.expedition) return null
  const p = f.expedition.progress
  const t = p < 0.5 ? p * 2 : 2 - p * 2
  return [f.x * t, f.y * t]
}

/** A parchment chart of the Hollowmere ranges: league rings, a compass rose, the forges and any airships aloft. */
function ChartMap({ saga, colony, selected, onSelect }: { saga: SagaInfo; colony: string; selected: string; onSelect: (id: string) => void }) {
  const maxLeagues = saga.maxLeagues
  const rings = [0.25, 0.5, 0.75, 1]
  return (
    <svg className="chart-map" viewBox="-1.18 -1.18 2.36 2.36" role="img" aria-label={saga.chartName}>
      <defs>
        <radialGradient id="chart-vignette" cx="0" cy="0" r="1.3" gradientUnits="userSpaceOnUse">
          <stop offset="0.6" stopColor="#e9dcbc" />
          <stop offset="1" stopColor="#c4ad80" />
        </radialGradient>
      </defs>
      <rect x="-1.18" y="-1.18" width="2.36" height="2.36" fill="url(#chart-vignette)" />
      {rings.map((r) => (
        <g key={r}>
          <circle r={0.18 + 0.78 * r} fill="none" stroke="#8a7458" strokeWidth="0.004" strokeDasharray="0.02 0.015" />
          <text x={0.005} y={-(0.18 + 0.78 * r) - 0.012} className="chart-ring-label">
            {Math.round(r * maxLeagues)} leagues
          </text>
        </g>
      ))}
      {/* Compass rose */}
      <g transform="translate(0.92 -0.92)" className="chart-compass">
        <circle r="0.11" fill="none" stroke="#6a5438" strokeWidth="0.005" />
        <path d="M0 -0.13 L0.025 0 L0 0.13 L-0.025 0 Z" fill="#6a5438" />
        <path d="M-0.13 0 L0 0.025 L0.13 0 L0 -0.025 Z" fill="#a08868" />
        <text y="-0.15" textAnchor="middle" className="chart-compass-n">
          N
        </text>
      </g>
      {/* Routes of expeditions in flight */}
      {saga.forges
        .filter((f) => f.expedition)
        .map((f) => (
          <line key={`route-${f.id}`} x1="0" y1="0" x2={f.x} y2={f.y} stroke="#5a3a1a" strokeWidth="0.006" strokeDasharray="0.025 0.018" />
        ))}
      {/* The colony */}
      <g className="chart-home">
        <circle r="0.06" fill="#d4a24a" stroke="#5a3a1a" strokeWidth="0.008" />
        <text y="0.012" textAnchor="middle" className="chart-home-num">
          9
        </text>
        <text y="0.11" textAnchor="middle" className="chart-label">
          {colony}
        </text>
      </g>
      {saga.forges.map((f) => (
        <g key={f.id} transform={`translate(${f.x} ${f.y})`} className={`chart-forge ${selected === f.id ? 'selected' : ''}`} onClick={() => onSelect(f.id)}>
          <circle r="0.065" fill="transparent" />
          {f.status !== 'answering' && f.fate === 'Overpressure' ? (
            <path d="M-0.045 0.03 L-0.03 -0.03 L0 0.01 L0.025 -0.04 L0.045 0.03 Z" fill={markerColor(f)} stroke="#3a2a18" strokeWidth="0.006" />
          ) : (
            <circle r="0.042" fill={markerColor(f)} stroke="#3a2a18" strokeWidth="0.007" />
          )}
          <text y="0.014" textAnchor="middle" className="chart-num">
            {f.status === 'silent' ? '?' : f.number}
          </text>
          <text y="0.085" textAnchor="middle" className="chart-label">
            {f.name}
          </text>
          {f.request && <circle cx="0.04" cy="-0.04" r="0.016" className="chart-alert" />}
        </g>
      ))}
      {saga.forges.map((f) => {
        const at = shipAt(f)
        if (!at) return null
        return (
          <g key={`ship-${f.id}`} transform={`translate(${at[0]} ${at[1]})`} className="chart-ship">
            <ellipse rx="0.04" ry="0.016" fill="#e8dcc0" stroke="#5a3a1a" strokeWidth="0.006" />
            <rect x="-0.012" y="0.014" width="0.024" height="0.01" fill="#5a3a1a" />
          </g>
        )
      })}
    </svg>
  )
}

function ForgeDetail({ forge: f, saga, controller }: { forge: ForgeRow; saga: SagaInfo; controller: GameController }) {
  const [crew, setCrew] = useState(saga.crew[0])
  const [notice, setNotice] = useState<string | null>(null)
  const launch = () => {
    const result = controller.perform({ type: 'launchExpedition', forge: f.id, crew })
    setNotice(result.ok ? null : result.reason)
  }
  const send = () => {
    const result = controller.perform({ type: 'fulfilRequest', forge: f.id })
    setNotice(result.ok ? null : result.reason)
  }
  return (
    <div className="forge-detail">
      <h3 className="engraved">
        Forge No. {f.number}: {f.name}
      </h3>
      <p className="muted small">
        {f.leagues} leagues · {f.months} month{f.months === 1 ? '' : 's'} each way by airship
      </p>
      {f.status === 'answering' ? (
        <>
          <p>
            <b className="ok-text">Answering.</b> {f.persona}
          </p>
          {f.relation !== null ? (
            <div className="forge-relation" title="Goodwill: help them and it grows; ignore them and they may fall silent">
              <span style={{ width: `${f.relation}%` }} />
            </div>
          ) : (
            <p className="muted small">{saga.telegraph ? 'Waiting for their first telegram.' : 'Build a Telegraph Office to reach them.'}</p>
          )}
          {f.request && (
            <div className="forge-request">
              <p className="telegram">{f.request.text}</p>
              <p className="small">
                Wants{' '}
                {f.request.wants.map((w) => (
                  <span key={w.name} className={w.have >= w.qty ? '' : 'warn'}>
                    {w.qty} {w.name} ({w.have} in store){' '}
                  </span>
                ))}
                · sends {f.request.gives} · {f.request.monthsLeft} months left
              </p>
              <Button size="sm" icon="check" onClick={send} disabled={!saga.telegraph || f.request.wants.some((w) => w.have < w.qty)}>
                Send the goods
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            <b>{f.fate ?? 'Silent'}.</b> {f.fateText ?? 'Nobody knows what became of it.'}
          </p>
          {f.rumour && <p className="muted small">{f.rumour}.</p>}
          {f.expedition ? (
            <p className="small">
              Expedition of {f.expedition.crew} {f.expedition.stage === 'outbound' ? 'outbound' : 'on the way home'}: back in {f.expedition.monthsLeft} months.
            </p>
          ) : (
            <div className="forge-launch">
              <div className="stepper">
                <span className="small">Crew</span>
                <Button size="sm" variant="iron" icon="minus" aria-label="Smaller crew" onClick={() => setCrew(Math.max(saga.crew[0], crew - 1))} />
                <b>{crew}</b>
                <Button size="sm" variant="iron" icon="plus" aria-label="Larger crew" onClick={() => setCrew(Math.min(saga.crew[1], crew + 1))} />
              </div>
              <p className="muted small">Costs {saga.launchCost}. The crew leave their homes and jobs until they return.</p>
              <Button size="sm" icon="play" onClick={launch} disabled={f.launchBlocked !== null}>
                Launch expedition
              </Button>
              {f.launchBlocked && <p className="warn small">{f.launchBlocked}</p>}
            </div>
          )}
        </>
      )}
      {notice && <p className="warn small">{notice}</p>}
    </div>
  )
}

/** The Hollowmere chart: the eleven other forges, the telegraph, expeditions, relics and the forge papers. */
export function ChartPanel({ hud, controller, onClose }: { hud: HudState; controller: GameController; onClose: () => void }) {
  const saga = hud.saga!
  const [selected, setSelected] = useState(saga.forges.find((f) => f.request)?.id ?? saga.forges[0]?.id ?? '')
  const forge = saga.forges.find((f) => f.id === selected)
  return (
    <Modal title={saga.chartName} onClose={onClose} wide>
      <div className="chart-layout">
        <ChartMap saga={saga} colony={hud.colonyName} selected={selected} onSelect={setSelected} />
        <div className="chart-side">
          {forge && <ForgeDetail key={forge.id} forge={forge} saga={saga} controller={controller} />}
          <div className="chart-status small">
            <p>
              {saga.yard ? 'Your Airship Yard can fit out expeditions.' : 'Expeditions need an Airship Yard (Expeditionary Airships).'}{' '}
              {saga.telegraph ? 'The telegraph is open.' : 'A Telegraph Office would reach the forges that still answer.'}
            </p>
            {saga.relics.length > 0 && (
              <>
                <h4>Relics</h4>
                <ul className="chart-relics">
                  {saga.relics.map((r) => (
                    <li key={r.name}>
                      <b>{r.name}</b>: {r.description}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted">
              {saga.papers} of the forge papers recovered (read them in the Dispatches ledger). Act {saga.act === 1 ? 'I' : saga.act === 2 ? 'II' : 'III'}.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Act III: the Steamforge's creeping core, and the two ways to answer it. Shown with the notices. */
export function FinaleCard({ finale, controller }: { finale: NonNullable<SagaInfo['finale']>; controller: GameController }) {
  if (finale.state === 'retrofitting') {
    return (
      <li className="petition-card finale-card">
        <div className="petition-head">
          <b>The Retrofit</b>
        </div>
        <p>Steamforge No. 9 stands open while the engineers fit its governor: {finale.monthsLeft} months to go. Keep the Brotherhood at work.</p>
      </li>
    )
  }
  if (finale.state !== 'pending') return null
  return (
    <li className="petition-card finale-card">
      <div className="petition-head">
        <b>The Creeping Core</b>
      </div>
      <p>
        Steamforge No. 9&apos;s core gauge reads <b>{Math.round(finale.creep * 100)}%</b> of bursting, and it raises extra steam as it climbs. At 100% it ruptures.
      </p>
      <div className="creep-gauge">
        <span style={{ width: `${Math.min(100, finale.creep * 100)}%` }} />
      </div>
      <div className="petition-actions">
        <Button size="sm" onClick={() => controller.perform({ type: 'finale', choice: 'retrofit' })} disabled={finale.retrofitBlocked !== null} title={finale.retrofitBlocked ?? 'Open the core and fit a governor'}>
          Unseal and retrofit
        </Button>
        <Button size="sm" variant="iron" onClick={() => controller.perform({ type: 'finale', choice: 'vent' })} disabled={finale.ventBlocked !== null}>
          Vent and seal it cold
        </Button>
      </div>
      {finale.retrofitBlocked && <p className="muted small">Retrofit: {finale.retrofitBlocked}</p>}
    </li>
  )
}
