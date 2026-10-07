import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CLOUD_SLOTS, putCloudSave, useCloudSaves } from '../../api/saves'
import type { ResourceCategory } from '../../api/types'
import type { GameController } from '../../game/GameController'
import { listLocalSaves, LOCAL_SLOTS, writeLocalSave } from '../../lib/saves'
import { useAuth } from '../../state/auth'
import type { HudState } from '../../state/game'
import { usePendingGame } from '../../state/pending'
import { type QualityTier, useSettings } from '../../state/settings'
import { lastMonthFlow, netClass, stockHistory } from '../../game/report'
import { Button, Modal, Tabs } from '../../ui/components'
import { Sparkline } from './Report'

const MOODS: Record<string, string> = { proud: 'Proud', content: 'Content', grumbling: 'Grumbling', workToRule: 'Working to rule', striking: 'On strike' }

/** The four guilds: standing, where it is heading and why, and whether automatons may work their trades. */
function GuildStandings({ hud, controller }: { hud: HudState; controller: GameController }) {
  if (hud.guilds.length === 0) return null
  return (
    <section className="guild-standings">
      <h3>Guilds</h3>
      <p className="muted small">
        Each trade belongs to a guild. A guild&apos;s standing drifts each month towards what its members live through. Proud guilds (70+) work
        faster; below 30 they work to rule, below 15 they strike, and a guild with nothing left to lose turns to sabotage and leaves the
        colony.{hud.automatonPledge > 0 ? ` You have pledged to build no automatons for ${hud.automatonPledge} more months.` : ''}
      </p>
      <div className="guild-grid">
        {hud.guilds.map((g) => (
          <article key={g.id} className={`guild-card mood-${g.mood}`} style={{ borderColor: g.color }}>
            <header>
              <i className="guild-dot" style={{ background: g.color }} />
              <b>{g.name}</b>
              <span className={`guild-mood mood-${g.mood}`}>{MOODS[g.mood]}</span>
            </header>
            <div className="guild-meter" title={`Standing ${Math.round(g.standing)}, heading for ${Math.round(g.target)}`}>
              <span className="fill" style={{ width: `${g.standing}%`, background: g.color }} />
              <span className="goal" style={{ left: `${g.target}%` }} />
              <span className="mark strike" style={{ left: '15%' }} />
              <span className="mark rule" style={{ left: '30%' }} />
              <span className="mark proud" style={{ left: '70%' }} />
            </div>
            <p className="muted small">
              Standing <b>{Math.round(g.standing)}</b>, heading for <b>{Math.round(g.target)}</b> · {g.members} members{g.hall ? ' · has a hall' : ''}
            </p>
            <ul className="guild-parts small">
              {g.parts
                .filter(([, v]) => Math.abs(v) >= 0.5)
                .map(([label, v]) => (
                  <li key={label} className={v >= 0 ? 'up' : 'down'}>
                    {label} {v >= 0 ? '+' : ''}
                    {Math.round(v)}
                  </li>
                ))}
            </ul>
            <label className="guild-policy small">
              <input
                type="checkbox"
                checked={g.mechanise}
                onChange={(e) => controller.perform({ type: 'setGuildPolicy', guild: g.id, mechanise: e.target.checked })}
              />{' '}
              Automatons may work these trades
              {g.automatonsInTrade > 0 ? ` (${g.automatonsInTrade} do)` : ''}
              <span className="muted"> · the {g.short} {g.automatonWeight < 0 ? 'resents' : 'welcomes'} them</span>
            </label>
          </article>
        ))}
      </div>
    </section>
  )
}

export function GuildPanel({ hud, controller, onClose }: { hud: HudState; controller: GameController; onClose: () => void }) {
  return (
    <Modal title="Guilds and Professions" onClose={onClose} wide>
      <GuildStandings hud={hud} controller={controller} />
      <p className="muted small">
        Everyone without a trade works as a laborer, hauling materials and clearing land. Builders raise construction sites and lay roads. Raising a
        profession assigns idle laborers to that trade&apos;s workplaces, and a trade&apos;s workers move between its workplaces to wherever there is
        work. To move one person, select them and choose their job, or use &quot;Bring a worker&quot; on a workplace.
      </p>
      <table className="prof-table">
        <thead>
          <tr>
            <th>Profession</th>
            <th>Workers</th>
            <th>Target</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Laborers</td>
            <td>{hud.laborers}</td>
            <td className="muted">idle pool</td>
            <td />
          </tr>
          <tr>
            <td>Builders</td>
            <td>{hud.builders.count}</td>
            <td>{hud.builders.target}</td>
            <td className="stepper">
              <Button size="sm" variant="iron" icon="minus" aria-label="Fewer" onClick={() => controller.perform({ type: 'setBuilders', count: hud.builders.target - 1 })} />
              <Button size="sm" variant="iron" icon="plus" aria-label="More" onClick={() => controller.perform({ type: 'setBuilders', count: hud.builders.target + 1 })} />
            </td>
          </tr>
          {hud.professions.map((p) => (
            <tr key={p.id}>
              <td>
                <i className="swatch" style={{ background: p.color }} /> {p.name}
              </td>
              <td>{p.workers}</td>
              <td>
                {p.target} <span className="muted">/ {p.max}</span>
              </td>
              <td className="stepper">
                <Button size="sm" variant="iron" icon="minus" aria-label="Fewer" onClick={() => controller.setProfessionTarget(p.id, p.target - 1)} />
                <Button size="sm" variant="iron" icon="plus" aria-label="More" onClick={() => controller.setProfessionTarget(p.id, p.target + 1)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`

const CATEGORY_NAMES: Record<ResourceCategory, string> = { food: 'Food', fuel: 'Fuel', material: 'Materials', goods: 'Goods' }

export function StoresPanel({ hud, controller, onClose, openLedger }: { hud: HudState; controller: GameController; onClose: () => void; openLedger: () => void }) {
  const [category, setCategory] = useState<ResourceCategory>('food')
  const commitLimit = (res: string, value: string) => controller.perform({ type: 'setLimit', res, limit: Number(value) || 0 })
  const rows = hud.resources.filter((r) => r.category === category)
  const flows = new Map(rows.map((r) => [r.id, lastMonthFlow(hud, r.id, () => r.name)]))
  const setTrade = (res: string, mode: 'export' | 'import' | 'none', amount: number) => controller.perform({ type: 'setTrade', res, mode, amount })
  return (
    <Modal title={hud.hasMast ? 'Stores, Limits and Airship Trade' : 'Stores and Production Limits'} onClose={onClose} wide>
      <Tabs tabs={(Object.keys(CATEGORY_NAMES) as ResourceCategory[]).map((c) => ({ id: c, label: CATEGORY_NAMES[c] }))} value={category} onChange={setCategory} />
      <div className="report-toolbar">
        <p className="muted small">
          Workers stop producing a resource once the stores hold its limit, and turn to labour instead. Clear the limit for no cap.
          {category === 'food' && Number.isFinite(hud.foodMonths) && (
            <>
              {' '}
              The food in store would feed everyone for <b>{hud.foodMonths.toFixed(1)}</b> months.
            </>
          )}
        </p>
        <Button size="sm" variant="iron" icon="chart" onClick={openLedger}>
          Production ledger
        </Button>
      </div>
      {hud.hasMast && (
        <p className="muted small">
          Airship trade: goods above an export amount are carried to the mast and credited at once. Imports are bought with Company credit (
          <b className="brass-text">{Math.floor(hud.credit)}</b>) when the next airship moors, up to the amount in storage, and cost more than exports earn.
        </p>
      )}
      <table className="prof-table">
        <thead>
          <tr>
            <th>Resource</th>
            <th>In storage</th>
            <th title="Net change over the last month">Last month</th>
            <th>Last year</th>
            <th>Limit</th>
            {hud.hasMast && <th>Airship trade</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <i className="swatch" style={{ background: r.color }} /> {r.name}
              </td>
              <td>{Math.floor(r.amount)}</td>
              <td className={netClass(flows.get(r.id)?.net ?? 0)} title={flows.get(r.id)?.title}>
                {flows.get(r.id) ? signed(flows.get(r.id)!.net) : '–'}
              </td>
              <td>
                <Sparkline values={stockHistory(hud, [r.id])} color={r.color} />
              </td>
              <td>
                <input
                  key={`${r.id}-${r.limit ?? ''}`}
                  className="limit-input"
                  type="number"
                  min={0}
                  step={10}
                  placeholder="none"
                  defaultValue={r.limit ?? ''}
                  onBlur={(e) => commitLimit(r.id, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              </td>
              {hud.hasMast && (
                <td className="trade-cell">
                  {r.value > 0 ? (
                    <>
                      <select
                        value={hud.trade[r.id]?.mode ?? 'none'}
                        onChange={(e) => setTrade(r.id, e.target.value as 'export' | 'import' | 'none', hud.trade[r.id]?.amount ?? Math.floor(r.amount))}
                      >
                        <option value="none">No trade</option>
                        <option value="export">Export above</option>
                        <option value="import">Import up to</option>
                      </select>
                      {hud.trade[r.id] && (
                        <input
                          className="limit-input"
                          type="number"
                          min={0}
                          step={10}
                          defaultValue={hud.trade[r.id].amount}
                          key={`${r.id}-${hud.trade[r.id].mode}`}
                          onBlur={(e) => setTrade(r.id, hud.trade[r.id].mode, Number(e.target.value) || 0)}
                        />
                      )}
                      <span className="muted small">{r.value} credit</span>
                    </>
                  ) : (
                    <span className="muted small">Not traded</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

export function GameMenu({ controller, onClose }: { controller: GameController; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signedIn = useAuth((s) => s.session !== null)
  const { settings, update } = useSettings()
  const local = useQuery({ queryKey: ['local-saves'], queryFn: listLocalSaves })
  const cloud = useCloudSaves()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setPending = usePendingGame((s) => s.set)

  const save = async (label: string, write: (data: string) => Promise<unknown>) => {
    setBusy(true)
    setStatus(`Saving to ${label}…`)
    try {
      await write(await controller.encode())
      setStatus(`Saved to ${label}.`)
      void queryClient.invalidateQueries({ queryKey: ['local-saves'] })
      void queryClient.invalidateQueries({ queryKey: ['saves'] })
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`)
    }
    setBusy(false)
  }

  return (
    <Modal title="Colony Ledger" onClose={onClose} wide>
      <div className="menu-grid">
        <section>
          <h4>Save on this device</h4>
          <ul className="slot-list">
            {LOCAL_SLOTS.map((id, i) => {
              const existing = local.data?.find((s) => s.id === id)
              return (
                <li key={id}>
                  <Button size="sm" variant="iron" icon="save" disabled={busy} onClick={() => void save(`device slot ${i + 1}`, (data) => writeLocalSave(id, controller.saveMeta(), data))}>
                    Slot {i + 1}
                  </Button>
                  <span className="muted small">{existing ? `${existing.name}: ${existing.summary}` : 'Empty'}</span>
                </li>
              )
            })}
          </ul>
          <h4>Save to the cloud</h4>
          {signedIn ? (
            <ul className="slot-list">
              {Array.from({ length: CLOUD_SLOTS }, (_, i) => i + 1).map((slot) => {
                const existing = cloud.data?.find((s) => s.slot === slot)
                return (
                  <li key={slot}>
                    <Button size="sm" variant="copper" icon="save" disabled={busy} onClick={() => void save(`cloud slot ${slot}`, (data) => putCloudSave(slot, controller.saveMeta(), data))}>
                      Cloud {slot}
                    </Button>
                    <span className="muted small">{existing ? `${existing.name}: ${existing.summary}` : 'Empty'}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted small">Sign in from the title screen to use cloud saves.</p>
          )}
          {status && <p className="small">{status}</p>}
        </section>
        <section>
          <h4>Graphics</h4>
          <Tabs<QualityTier>
            tabs={(['auto', 'low', 'medium', 'high', 'ultra'] as const).map((q) => ({ id: q, label: q }))}
            value={settings.quality}
            onChange={(quality) => update({ quality })}
          />
          <h4>Volume</h4>
          <label className="slider-row">
            <span>Master</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.masterVolume} onChange={(e) => update({ masterVolume: Number(e.target.value) })} />
          </label>
          <label className="slider-row">
            <span>Music</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume} onChange={(e) => update({ musicVolume: Number(e.target.value) })} />
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={settings.edgeScroll} onChange={(e) => update({ edgeScroll: e.target.checked })} />
            <span>Edge scrolling</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={settings.dayNight} onChange={(e) => update({ dayNight: e.target.checked })} />
            <span>Night darkness</span>
          </label>
          <div className="menu-actions">
            <Button icon="play" onClick={onClose}>
              Resume
            </Button>
            <Button
              variant="danger"
              icon="back"
              onClick={() => {
                setPending(null)
                navigate('/')
              }}
            >
              Exit to title
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}

export function Outcome({ controller }: { controller: GameController }) {
  const navigate = useNavigate()
  const setPending = usePendingGame((s) => s.set)
  const sim = controller.sim
  const stats = sim.stats
  return (
    <div className="modal-scrim">
      <div className="modal outcome">
        <h2 className="engraved">{sim.options.name} has fallen</h2>
        <p className="muted">The last colonist is gone after {sim.year - 1} years.</p>
        <ul className="kv">
          <li>
            <span>Peak population</span>
            <b>{stats.peakPopulation}</b>
          </li>
          <li>
            <span>Births</span>
            <b>{stats.births}</b>
          </li>
          <li>
            <span>Arrivals</span>
            <b>{stats.arrivals}</b>
          </li>
          {Object.entries(stats.deathsBy).map(([cause, n]) => (
            <li key={cause}>
              <span>Deaths ({cause})</span>
              <b>{n}</b>
            </li>
          ))}
        </ul>
        <div className="menu-actions">
          <Button icon="play" onClick={() => navigate('/new')}>
            Found a new colony
          </Button>
          <Button
            variant="iron"
            icon="back"
            onClick={() => {
              setPending(null)
              navigate('/')
            }}
          >
            Title
          </Button>
        </div>
      </div>
    </div>
  )
}
