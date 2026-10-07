import { type PointerEvent, useId, useMemo, useState } from 'react'
import { useLoadedContent } from '../../api/content'
import type { ResourceCategory } from '../../api/types'
import type { GameController } from '../../game/GameController'
import { flowOf, lastMonthFlow, netClass, outOf, peakUse, stockHistory, stockOf } from '../../game/report'
import type { Concern, HudState, ResourceRow, WorkplaceRow, WorkStatus } from '../../state/game'
import { Button, Modal, Tabs } from '../../ui/components'
import { Icon, type IconName } from '../../ui/Icon'

export type ReportTab = 'overview' | 'workplaces' | 'production'

/** Labels a ledger month as "Early Spring, Year 2". */
function useMonthLabel() {
  const months = useLoadedContent().bundle.rules.months
  return (m: number) => `${months[m % months.length]}, Year ${Math.floor(m / months.length) + 1}`
}

const round = (v: number) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10)
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(round(v))}`

// ---------------------------------------------------------------- charts

interface Series {
  label: string
  color: string
  values: number[]
}

/**
 * A small line chart over ledger months: one shared y-axis from zero, year gridlines, a crosshair with a tooltip on
 * hover. More than one series gets a legend (and they must share a unit).
 */
export function HistoryChart({ title, months, series, unit = '' }: { title: string; months: number[]; series: Series[]; unit?: string }) {
  const label = useMonthLabel()
  const perYear = useLoadedContent().bundle.rules.months.length
  const clip = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 320
  const H = 110
  const pad = { l: 30, r: 8, t: 8, b: 16 }
  const n = months.length
  const top = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const x = (i: number) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const yearStarts = months.map((m, i) => [m, i] as const).filter(([m]) => m % perYear === 0)
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  return (
    <figure className="history-chart">
      <figcaption>
        <b>{title}</b>
        {series.length > 1 && (
          <span className="chart-legend">
            {series.map((s) => (
              <span key={s.label}>
                <i style={{ background: s.color }} /> {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      {n < 2 ? (
        <p className="muted small chart-empty">The ledger fills in as the months close.</p>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <defs>
              <clipPath id={clip}>
                <rect x={pad.l} y={0} width={W - pad.l - pad.r} height={H - pad.b + 1} />
              </clipPath>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} />
                <text className="chart-tick" x={pad.l - 4} y={y(top * f) + 3} textAnchor="end">
                  {compact(top * f)}
                </text>
              </g>
            ))}
            {yearStarts.map(([m, i]) => (
              <g key={m}>
                <line className="chart-grid year" x1={x(i)} x2={x(i)} y1={pad.t} y2={H - pad.b} />
                <text className="chart-tick" x={x(i)} y={H - 4} textAnchor="middle">
                  Y{Math.floor(m / perYear) + 1}
                </text>
              </g>
            ))}
            <g clipPath={`url(#${clip})`}>
              {series.map((s) => (
                <polyline key={s.label} className="chart-line" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} stroke={s.color} />
              ))}
            </g>
            {hover !== null && (
              <g>
                <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
                {series.map((s) => (
                  <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r={3} fill={s.color} className="chart-dot" />
                ))}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className={`chart-tip ${hover > n / 2 ? 'left' : ''}`} style={{ left: `${(x(hover) / W) * 100}%` }}>
              <b>{label(months[hover])}</b>
              {series.map((s) => (
                <span key={s.label}>
                  {series.length > 1 && <i style={{ background: s.color }} />}
                  {series.length > 1 ? `${s.label}: ` : ''}
                  {round(s.values[hover])}
                  {unit}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

/** The first 1, 2 or 5 step at or above `v`. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const k of [1, 2, 5, 10]) if (k * p >= v) return k * p
  return 10 * p
}

const compact = (v: number) => (v >= 1000 ? `${round(v / 1000)}k` : `${round(v)}`)

/** A bare trend line for table rows: the stock over the last year. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className="sparkline muted small">–</span>
  const W = 64
  const H = 18
  const top = Math.max(1, ...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (W - 2) + 1},${H - 1 - (v / top) * (H - 2)}`).join(' ')
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline points={pts} stroke={color} />
    </svg>
  )
}

// ---------------------------------------------------------------- the panel

export function ReportPanel({
  hud,
  controller,
  onClose,
  initial = 'overview',
}: {
  hud: HudState
  controller: GameController
  onClose: () => void
  initial?: ReportTab
}) {
  const [tab, setTab] = useState<ReportTab>(initial)
  const urgent = hud.concerns.filter((c) => c.level !== 'info').length
  return (
    <Modal title="Overseer's Report" onClose={onClose} wide>
      <Tabs<ReportTab>
        tabs={[
          {
            id: 'overview',
            label: urgent > 0 ? `Overview (${urgent})` : 'Overview',
          },
          { id: 'workplaces', label: 'Workplaces' },
          { id: 'production', label: 'Production' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' && <Overview hud={hud} controller={controller} onClose={onClose} />}
      {tab === 'workplaces' && <Workplaces hud={hud} controller={controller} onClose={onClose} />}
      {tab === 'production' && <Production hud={hud} />}
    </Modal>
  )
}

const CONCERN_ICON: Record<Concern['level'], IconName> = {
  bad: 'skull',
  warn: 'info',
  info: 'clock',
}

function Overview({ hud, controller, onClose }: { hud: HudState; controller: GameController; onClose: () => void }) {
  const content = useLoadedContent()
  const foodIds = useMemo(() => content.bundle.resources.filter((r) => r.category === 'food').map((r) => r.id), [content])
  const months = [...hud.ledger.map((m) => m.m), hud.ledger.length ? hud.ledger[hud.ledger.length - 1].m + 1 : 0]
  const firewood = hud.resources.find((r) => r.id === 'firewood')
  const burn = peakUse(hud.ledger, ['firewood'])
  const d = hud.demographics
  const people = hud.population.total
  const yearAgo = hud.ledger.at(-12)?.people
  const tiles: {
    label: string
    value: string
    note?: string
    bad?: boolean
  }[] = [
    {
      label: 'people',
      value: `${people}`,
      note: yearAgo !== undefined ? `${signed(people - yearAgo)} in a year` : undefined,
    },
    {
      label: 'months of food',
      value: Number.isFinite(hud.foodMonths) ? hud.foodMonths.toFixed(1) : '–',
      bad: hud.foodMonths < 3,
    },
    {
      label: 'months of firewood',
      value: burn > 0 ? ((firewood?.amount ?? 0) / burn).toFixed(1) : '–',
      note: burn > 0 ? `at winter's ${Math.round(burn)}/month` : 'no winter on the books yet',
      bad: burn > 0 && (firewood?.amount ?? 0) / burn < 2.5,
    },
    {
      label: 'vacant homes',
      value: `${d.homes - d.households}`,
      note: hud.population.homeless > 0 ? `${hud.population.homeless} homeless` : undefined,
      bad: hud.population.homeless > 0,
    },
    {
      label: 'happiness',
      value: `${Math.round(d.happiness * 100)}%`,
      bad: d.happiness < 0.4,
    },
    {
      label: 'health',
      value: `${Math.round(d.health * 100)}%`,
      bad: d.health < 0.5,
    },
  ]
  const series = (ids: string[]) => [
    ...hud.ledger.map((m) => stockOf(m, ids)),
    ids.reduce((s, id) => s + (hud.resources.find((r) => r.id === id)?.amount ?? 0), 0),
  ]
  const color = (id: string) => content.resources.get(id)?.color ?? 'var(--brass)'
  return (
    <div className="report-overview">
      <div className="pop-summary">
        {tiles.map((t) => (
          <div key={t.label} className={t.bad ? 'tile-bad' : ''}>
            <b>{t.value}</b>
            <span className="muted small">{t.label}</span>
            {t.note && <span className="muted tiny">{t.note}</span>}
          </div>
        ))}
      </div>
      <div className="report-grid">
        <section>
          <h3>The overseer notes</h3>
          {hud.concerns.length === 0 ? (
            <p className="muted small">All is in order. The colony is fed, housed and at work.</p>
          ) : (
            <ul className="concerns">
              {hud.concerns.map((c) => (
                <li key={c.text} className={`concern concern-${c.level}`}>
                  <Icon name={CONCERN_ICON[c.level]} size={14} />
                  {c.building !== undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        controller.focusBuilding(c.building!)
                        onClose()
                      }}
                      title="Show on the map"
                    >
                      {c.text}
                    </button>
                  ) : (
                    <span>{c.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="report-charts">
          <HistoryChart
            title="People"
            months={months}
            series={[
              {
                label: 'People',
                color: 'var(--brass-hi)',
                values: [...hud.ledger.map((m) => m.people), people],
              },
            ]}
          />
          <HistoryChart
            title="Food in store"
            months={months}
            series={[
              {
                label: 'Food',
                color: color(foodIds[0] ?? 'wheat'),
                values: series(foodIds),
              },
            ]}
          />
          <HistoryChart
            title="Firewood in store"
            months={months}
            series={[
              {
                label: 'Firewood',
                color: color('firewood'),
                values: series(['firewood']),
              },
            ]}
          />
        </section>
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<WorkStatus, string> = {
  working: 'Working',
  idle: 'Idle',
  unstaffed: 'No workers',
  stoodDown: 'Stood down',
  storesFull: 'Stores full',
  noPower: 'No power',
  waiting: 'No materials',
  atLimit: 'At limit',
  striking: 'On strike',
  burning: 'On fire',
}

const STATUS_TONE: Record<WorkStatus, 'ok' | 'quiet' | 'warn' | 'bad'> = {
  working: 'ok',
  idle: 'quiet',
  stoodDown: 'quiet',
  atLimit: 'quiet',
  unstaffed: 'warn',
  storesFull: 'warn',
  noPower: 'warn',
  waiting: 'warn',
  striking: 'bad',
  burning: 'bad',
}

function Workplaces({ hud, controller, onClose }: { hud: HudState; controller: GameController; onClose: () => void }) {
  const [problems, setProblems] = useState(false)
  const groups = new Map<string, WorkplaceRow[]>()
  for (const w of hud.workplaces) {
    if (problems && STATUS_TONE[w.status] !== 'warn' && STATUS_TONE[w.status] !== 'bad') continue
    const list = groups.get(w.profession) ?? []
    list.push(w)
    groups.set(w.profession, list)
  }
  const setWorkers = (w: WorkplaceRow, count: number) =>
    controller.perform({
      type: 'setWorkers',
      building: w.id,
      count: Math.max(0, Math.min(w.max, count)),
    })
  return (
    <div className="report-workplaces">
      <div className="report-toolbar">
        <p className="muted small">
          {hud.laborers} laborers free · {hud.builders.count}/{hud.builders.target} builders. Raising a crew takes idle laborers; lowering it sends workers back
          to labour.
        </p>
        <label className="toggle-row small">
          <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} />
          <span>Only those in trouble</span>
        </label>
      </div>
      {groups.size === 0 && <p className="muted small">{problems ? 'Every workplace is in order.' : 'No workplaces have been built yet.'}</p>}
      <table className="prof-table workplace-table">
        <tbody>
          {[...groups.entries()].map(([prof, rows]) => {
            const all = hud.professions.find((p) => p.id === prof)
            return [
              <tr key={prof} className="group-row">
                <th colSpan={2}>
                  <i className="swatch" style={{ background: rows[0].color }} /> {rows[0].professionName}
                </th>
                <th className="num">
                  {all ? `${all.workers} / ${all.target}` : ''}
                  {all && <span className="muted"> of {all.max}</span>}
                </th>
                <th className="stepper">
                  {all && (
                    <>
                      <Button
                        size="sm"
                        variant="iron"
                        icon="minus"
                        aria-label={`Fewer ${all.name}`}
                        onClick={() => controller.setProfessionTarget(prof, all.target - 1)}
                      />
                      <Button
                        size="sm"
                        variant="iron"
                        icon="plus"
                        aria-label={`More ${all.name}`}
                        onClick={() => controller.setProfessionTarget(prof, all.target + 1)}
                      />
                    </>
                  )}
                </th>
              </tr>,
              ...rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        controller.focusBuilding(w.id)
                        onClose()
                      }}
                      title="Show on the map"
                    >
                      {w.name}
                    </button>
                  </td>
                  <td>
                    <span className={`status-pill tone-${STATUS_TONE[w.status]}`} title={w.detail}>
                      {STATUS_LABEL[w.status]}
                    </span>
                    {w.status !== 'working' && w.detail !== STATUS_LABEL[w.status] && <span className="muted small"> {w.detail}</span>}
                  </td>
                  <td className="num">
                    {w.workers} / {w.target}
                    <span className="muted"> of {w.max}</span>
                  </td>
                  <td className="stepper">
                    <Button
                      size="sm"
                      variant="iron"
                      icon="minus"
                      aria-label="Fewer workers"
                      disabled={w.target <= 0}
                      onClick={() => setWorkers(w, w.target - 1)}
                    />
                    <Button
                      size="sm"
                      variant="iron"
                      icon="plus"
                      aria-label="More workers"
                      disabled={w.target >= w.max}
                      onClick={() => setWorkers(w, w.target + 1)}
                    />
                  </td>
                </tr>
              )),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

const CATEGORY_NAMES: Record<ResourceCategory, string> = {
  food: 'Food',
  fuel: 'Fuel',
  material: 'Materials',
  goods: 'Goods',
}

function Production({ hud }: { hud: HudState }) {
  const content = useLoadedContent()
  const label = useMonthLabel()
  const [category, setCategory] = useState<ResourceCategory>('food')
  const [picked, setPicked] = useState<string | null>(null)
  // Goods the colony has never held, made or used are left out until they matter.
  const seen = (id: string) => hud.ledger.some((m) => m.stock[id] || m.made[id] || m.used[id])
  const all = hud.resources.filter((r) => r.category === category)
  const rows = all.filter((r) => r.amount > 0 || seen(r.id))
  const chosen: ResourceRow | undefined = rows.find((r) => r.id === picked) ?? rows[0]
  const last = hud.ledger.at(-1)
  const year = hud.ledger.slice(-12)
  const name = (id: string) => content.resources.get(id)?.name ?? id
  const months = [...hud.ledger.map((m) => m.m), (last?.m ?? -1) + 1]
  return (
    <div className="report-production">
      <Tabs
        tabs={(Object.keys(CATEGORY_NAMES) as ResourceCategory[]).map((c) => ({
          id: c,
          label: CATEGORY_NAMES[c],
        }))}
        value={category}
        onChange={setCategory}
      />
      <p className="muted small">
        {last
          ? `The books for ${label(last.m)}, and the average over the last ${year.length} month${year.length === 1 ? '' : 's'}.`
          : 'The first month has not closed yet.'}{' '}
        Click a row to chart it.
        {all.length > rows.length && ` ${all.length - rows.length} more ${all.length - rows.length === 1 ? 'has' : 'have'} not been made yet.`}
      </p>
      <div className="table-scroll">
        <table className="prof-table ledger-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th className="num">In store</th>
              <th className="num">Made</th>
              <th className="num">Used</th>
              <th className="num">Net</th>
              <th className="num" title="Average net change per month over the last year">
                Avg/month
              </th>
              <th>Last year</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = last ? flowOf(last, r.id) : null
              const avg = year.length ? year.reduce((s, m) => s + flowOf(m, r.id).made - outOf(flowOf(m, r.id)), 0) / year.length : null
              const flow = lastMonthFlow(hud, r.id, name)
              return (
                <tr key={r.id} className={`clickable ${chosen?.id === r.id ? 'selected' : ''}`} onClick={() => setPicked(r.id)} title={flow?.title}>
                  <td>
                    <i className="swatch" style={{ background: r.color }} /> {r.name}
                  </td>
                  <td className="num">{Math.floor(r.amount)}</td>
                  <td className="num">{f ? round(f.made) : '–'}</td>
                  <td className="num">{f ? round(outOf(f)) : '–'}</td>
                  <td className={`num ${f ? netClass(f.made - outOf(f)) : ''}`}>{f ? signed(f.made - outOf(f)) : '–'}</td>
                  <td className={`num ${avg !== null ? netClass(avg) : ''}`}>{avg !== null ? signed(avg) : '–'}</td>
                  <td>
                    <Sparkline values={stockHistory(hud, [r.id])} color={r.color} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {chosen && (
        <div className="report-charts two">
          <HistoryChart
            title={`${chosen.name} in store`}
            months={months}
            series={[
              {
                label: chosen.name,
                color: chosen.color,
                values: stockHistory(hud, [chosen.id], hud.ledger.length),
              },
            ]}
          />
          <HistoryChart
            title={`${chosen.name} made and used each month`}
            months={hud.ledger.map((m) => m.m)}
            series={[
              {
                label: 'Made',
                color: 'var(--ok)',
                values: hud.ledger.map((m) => flowOf(m, chosen.id).made),
              },
              {
                label: 'Used',
                color: 'var(--ember)',
                values: hud.ledger.map((m) => outOf(flowOf(m, chosen.id))),
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}
