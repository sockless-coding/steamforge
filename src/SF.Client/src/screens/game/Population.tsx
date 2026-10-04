import type { Demographics, HudState } from '../../state/game'
import { Modal, ProgressBar } from '../../ui/components'

const CAUSES: Record<string, string> = {
  starvation: 'Starvation',
  cold: 'Cold',
  age: 'Old age',
  sickness: 'Fever',
  soot: 'Black lung',
  fire: 'Fire',
  sabotage: 'Sabotage',
  rupture: 'The rupture',
}

const percent = (v: number) => `${Math.round(v * 100)}%`

/** Men to the left, women to the right, youngest at the bottom; the bands where children come of age and adults turn elder are marked. */
function AgePyramid({ d }: { d: Demographics }) {
  const widest = Math.max(1, ...d.bands.map((b) => Math.max(b.men, b.women)))
  const stage = (from: number) => (from < d.adultAge ? 'child' : from >= d.elderAge ? 'elder' : 'adult')
  return (
    <div className="pyramid" role="table" aria-label="Age pyramid">
      <div className="pyramid-head muted small" role="row">
        <span>Men {d.men}</span>
        <span>Age</span>
        <span>Women {d.women}</span>
      </div>
      {[...d.bands].reverse().map((b) => (
        <div key={b.from} className={`pyramid-row stage-${stage(b.from)}`} role="row" title={`${b.men} men, ${b.women} women aged ${b.from}${b.to === null ? '+' : `–${b.to}`}`}>
          <span className="pyramid-side men">
            {b.men > 0 && <em>{b.men}</em>}
            <i style={{ width: `${(b.men / widest) * 100}%` }} />
          </span>
          <span className="pyramid-age">{b.to === null ? `${b.from}+` : b.from}</span>
          <span className="pyramid-side women">
            <i style={{ width: `${(b.women / widest) * 100}%` }} />
            {b.women > 0 && <em>{b.women}</em>}
          </span>
        </div>
      ))}
      <div className="pyramid-key muted small">
        <span className="key-child">Children (under {d.adultAge})</span>
        <span className="key-adult">Adults</span>
        <span className="key-elder">Elders ({d.elderAge}+)</span>
      </div>
    </div>
  )
}

function Average({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="need" title={`Colony average: ${percent(value)}`}>
      <span>{label}</span>
      <ProgressBar value={value} max={1} color={value < 0.3 ? 'var(--danger)' : color} />
    </div>
  )
}

export function PopulationPanel({ hud, onClose }: { hud: HudState; onClose: () => void }) {
  const p = hud.population
  const d = hud.demographics
  const people = p.total
  const occupations: { label: string; n: number; cls: string }[] = [
    { label: 'In a trade', n: d.work.trades, cls: 'trades' },
    { label: 'Builders', n: d.work.builders, cls: 'builders' },
    { label: 'Laborers', n: d.work.laborers, cls: 'laborers' },
    { label: 'Children', n: d.work.children, cls: 'children' },
  ]
  const wants: [string, number, string][] = [
    ['Homeless', p.homeless, 'Waiting for a vacant home, sheltering at the Guildhall'],
    ['Hungry', d.hungry, 'Below the hunger threshold and looking for a meal'],
    ['Cold', d.cold, 'Too cold: they go home to warm up and will freeze if they cannot'],
    ['Sick with fever', d.sick, 'Fevered citizens work slowly and may die'],
    ['Without tools', d.noTools, 'Working-age citizens without tools work at half pace'],
    ['Without a coat', d.noCoat, 'Working-age citizens without a coat chill faster in winter'],
  ]
  return (
    <Modal title="Population" onClose={onClose} wide>
      <div className="pop-summary">
        <div>
          <b>{people}</b>
          <span className="muted small">people</span>
        </div>
        <div>
          <b>{p.children}</b>
          <span className="muted small">children</span>
        </div>
        <div>
          <b>{p.adults}</b>
          <span className="muted small">adults</span>
        </div>
        <div>
          <b>{p.elders}</b>
          <span className="muted small">elders</span>
        </div>
        {p.automatons > 0 && (
          <div>
            <b>{p.automatons}</b>
            <span className="muted small">automatons</span>
          </div>
        )}
        <div>
          <b>{d.averageAge.toFixed(1)}</b>
          <span className="muted small">average age</span>
        </div>
      </div>
      <div className="pop-grid">
        <section>
          <h3>Ages</h3>
          <AgePyramid d={d} />
        </section>
        <section>
          <h3>Households</h3>
          <ul className="kv">
            <li>
              <span>Homes occupied</span>
              <b>
                {d.households} <span className="muted">/ {d.homes}</span>
              </b>
            </li>
            <li>
              <span>Married couples</span>
              <b>{d.couples}</b>
            </li>
            <li>
              <span>Beds in use</span>
              <b>
                {people - p.homeless} <span className="muted">/ {d.beds}</span>
              </b>
            </li>
          </ul>

          <h3>Occupations</h3>
          <div className="pop-stack" aria-hidden="true">
            {occupations.map((o) => o.n > 0 && <i key={o.cls} className={`occ-${o.cls}`} style={{ flexGrow: o.n }} />)}
          </div>
          <ul className="kv">
            {occupations.map((o) => (
              <li key={o.cls}>
                <span>
                  <i className={`swatch occ-${o.cls}`} /> {o.label}
                </span>
                <b>{o.n}</b>
              </li>
            ))}
          </ul>

          <h3>Wellbeing</h3>
          <Average label="Health" value={d.health} color="var(--ok)" />
          <Average label="Happiness" value={d.happiness} color="var(--brass-hi)" />
          <ul className="kv">
            {wants.map(([label, n, tip]) => (
              <li key={label} className={n > 0 ? 'pending' : ''} title={tip}>
                <span>{label}</span>
                <b>{n}</b>
              </li>
            ))}
          </ul>

          <h3>Since the founding</h3>
          <ul className="kv">
            <li>
              <span>Births</span>
              <b>{d.births}</b>
            </li>
            <li>
              <span>Arrivals</span>
              <b>{d.arrivals}</b>
            </li>
            <li>
              <span>Departures</span>
              <b>{d.departures}</b>
            </li>
            <li>
              <span>Deaths</span>
              <b>{d.deaths}</b>
            </li>
            {d.deathsBy.map(([cause, n]) => (
              <li key={cause} className="sub">
                <span className="muted">{CAUSES[cause] ?? cause}</span>
                <b className="muted">{n}</b>
              </li>
            ))}
            <li>
              <span>Peak population</span>
              <b>{hud.peakPopulation}</b>
            </li>
          </ul>
        </section>
      </div>
    </Modal>
  )
}
