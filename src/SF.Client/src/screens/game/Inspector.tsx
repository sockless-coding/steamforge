import type { GameController } from '../../game/GameController'
import type { BuildingInfo, CitizenInfo, JobChoice } from '../../state/game'
import { Button, Panel, ProgressBar } from '../../ui/components'
import { Icon } from '../../ui/Icon'

function NeedBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="need">
      <span>{label}</span>
      <ProgressBar value={value} max={1} color={value < 0.3 ? 'var(--danger)' : color} />
    </div>
  )
}

export function Inspector({ info, controller }: { info: BuildingInfo | CitizenInfo; controller: GameController }) {
  return (
    <aside className="inspector">
      <Panel>
        <button type="button" className="modal-close" onClick={() => controller.select(null)} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
        {info.kind === 'building' ? <BuildingPanel info={info} controller={controller} /> : <CitizenPanel info={info} controller={controller} />}
      </Panel>
    </aside>
  )
}

function BuildingPanel({ info, controller }: { info: BuildingInfo; controller: GameController }) {
  const site = info.site
  return (
    <>
      <h3 className="engraved">{info.name}</h3>
      {info.burning && (
        <p className="badge-fire">
          <Icon name="flame" size={16} /> On fire!
        </p>
      )}
      <p className="muted small">{info.description}</p>

      {site ? (
        <section>
          <h4>{site.stage === 'clearing' ? 'Clearing the ground' : 'Under construction'}</h4>
          <ProgressBar value={site.progress} max={1} label={`${Math.round(site.progress * 100)}%`} />
          {site.materials.length > 0 && (
            <ul className="kv">
              {site.materials.map((m) => (
                <li key={m.id} className={m.have < m.need ? 'pending' : ''}>
                  <span>{m.name}</span>
                  <b>
                    {m.have} / {m.need}
                  </b>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <Button size="sm" variant={site.priority ? 'copper' : 'iron'} icon="star" onClick={() => controller.perform({ type: 'prioritise', building: info.id, priority: !site.priority })}>
              {site.priority ? 'Priority' : 'Prioritise'}
            </Button>
            {info.canResize && (
              <Button size="sm" variant="iron" icon="wrench" onClick={() => controller.resizeSelected()}>
                Resize
              </Button>
            )}
            <Button size="sm" variant="danger" icon="close" onClick={() => controller.demolishSelected()}>
              Cancel
            </Button>
          </div>
        </section>
      ) : (
        <>
          {info.lines.length > 0 && (
            <ul className="lines">
              {info.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {info.maxWorkers > 0 && (
            <section>
              <h4>Workers</h4>
              <div className="stepper">
                <Button size="sm" variant="iron" icon="minus" aria-label="Fewer workers" onClick={() => controller.perform({ type: 'setWorkers', building: info.id, count: info.workerTarget - 1 })} />
                <b>
                  {info.workers.length} / {info.workerTarget}
                </b>
                <Button size="sm" variant="iron" icon="plus" aria-label="More workers" onClick={() => controller.perform({ type: 'setWorkers', building: info.id, count: info.workerTarget + 1 })} />
                <span className="muted small">max {info.maxWorkers}</span>
              </div>
              <ul className="names">
                {info.workers.map((w) => (
                  <li key={w.id} className={w.pinned ? 'pinned' : ''}>
                    <button type="button" onClick={() => controller.focusCitizen(w.id)}>
                      {w.name}
                    </button>
                    <button
                      type="button"
                      className="pin"
                      title={w.pinned ? 'Placed by you: click to let the overseer decide' : 'Keep them here'}
                      aria-label={w.pinned ? `Let the overseer decide for ${w.name}` : `Keep ${w.name} here`}
                      aria-pressed={w.pinned}
                      onClick={() => controller.perform({ type: 'assignCitizen', citizen: w.id, job: w.pinned ? 'auto' : info.id })}
                    >
                      <Icon name="lock" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {info.candidates.length > 0 && (
                <label className="field">
                  <span>Bring a worker</span>
                  <select
                    value=""
                    onChange={(e) => e.target.value && controller.perform({ type: 'assignCitizen', citizen: Number(e.target.value), job: info.id })}
                  >
                    <option value="">Choose someone…</option>
                    {info.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.job})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="muted small">Workers you bring or lock stay put. The rest go wherever their trade needs hands.</p>
            </section>
          )}
          {info.residents.length > 0 && (
            <section>
              <h4>Household</h4>
              <ul className="names">
                {info.residents.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => controller.focusCitizen(r.id)}>
                      {r.name} <span className="muted">({r.age})</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {info.options.map((o) => (
            <label key={o.key} className="field">
              <span>{o.label}</span>
              <select value={o.value} onChange={(e) => controller.perform({ type: 'setOption', building: info.id, key: o.key, value: e.target.value })}>
                {o.values.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {info.stock.length > 0 && (
            <section>
              <h4>Contents</h4>
              <ul className="kv">
                {info.stock.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <b>{Math.floor(s.amount)}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(info.canDemolish || info.canResize) && (
            <div className="row">
              {info.canResize && (
                <Button size="sm" variant="iron" icon="wrench" onClick={() => controller.resizeSelected()}>
                  Resize
                </Button>
              )}
              {info.canDemolish && (
                <Button size="sm" variant="danger" icon="trash" onClick={() => controller.demolishSelected()}>
                  Demolish
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

function CitizenPanel({ info, controller }: { info: CitizenInfo; controller: GameController }) {
  if (info.automaton) return <AutomatonPanel info={info} automaton={info.automaton} controller={controller} />
  return (
    <>
      <h3 className="engraved">{info.name}</h3>
      <p className="muted small">
        {info.female ? 'Woman' : 'Man'}, {info.age} · {info.profession}
        {info.sick && <span className="warn"> · feverish</span>}
      </p>
      <ul className="kv">
        <li>
          <span>Doing</span>
          <b>{info.task ?? 'Nothing'}</b>
        </li>
        <li>
          <span>Home</span>
          <b className={info.home ? '' : 'warn'}>{info.home ?? 'Homeless'}</b>
        </li>
        {info.workplace && (
          <li>
            <span>Works at</span>
            <b>{info.workplace}</b>
          </li>
        )}
        {info.job && <JobPicker id={info.id} job={info.job} controller={controller} />}
        {info.guild && (
          <li>
            <span>Guild</span>
            <b>
              <i className="guild-dot" style={{ background: info.guild.color }} /> {info.guild.name}
              {info.guild.striking && <span className="warn"> · on strike</span>}
            </b>
          </li>
        )}
        {info.carrying && (
          <li>
            <span>Carrying</span>
            <b>{info.carrying}</b>
          </li>
        )}
        <li>
          <span>Tools</span>
          <b className={info.tools > 0 ? '' : 'warn'}>{info.tools > 0 ? `${Math.ceil(info.tools)} months left` : 'None'}</b>
        </li>
        <li>
          <span>Coat</span>
          <b className={info.coat > 0 ? '' : 'warn'}>{info.coat > 0 ? `${Math.ceil(info.coat)} months left` : 'None'}</b>
        </li>
      </ul>
      <NeedBar label="Fed" value={info.hunger} color="var(--acid)" />
      <NeedBar label="Warm" value={info.warmth} color="var(--ember)" />
      <NeedBar label="Health" value={info.health} color="var(--ok)" />
      <NeedBar label="Happiness" value={info.happiness} color="var(--brass-hi)" />
      <div className="row">
        <Button size="sm" variant="iron" icon="eye" onClick={() => controller.focusCitizen(info.id)}>
          Follow
        </Button>
      </div>
    </>
  )
}

/** The player's job order for a citizen: the overseer decides, or a job of the player's choosing that sticks. */
function JobPicker({ id, job, controller }: { id: number; job: JobChoice; controller: GameController }) {
  const assign = (value: string) =>
    controller.perform({ type: 'assignCitizen', citizen: id, job: value === 'auto' || value === 'laborer' || value === 'builder' ? value : Number(value) })
  return (
    <li className="job-picker">
      <span>Job</span>
      <select value={job.value} onChange={(e) => assign(e.target.value)} aria-label="Job">
        <option value="auto">Overseer decides</option>
        <option value="laborer">Laborer</option>
        <option value="builder">Builder</option>
        {job.trades.map((t) => (
          <optgroup key={t.name} label={t.name}>
            {t.places.map((p) => (
              <option key={p.id} value={p.id} disabled={p.full}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </li>
  )
}

function AutomatonPanel({ info, automaton, controller }: { info: CitizenInfo; automaton: { wind: number; windMonths: number }; controller: GameController }) {
  return (
    <>
      <h3 className="engraved">{info.name}</h3>
      <p className="muted small">Clockwork automaton · {info.profession}</p>
      <ul className="kv">
        <li>
          <span>Doing</span>
          <b>{info.task ?? 'Nothing'}</b>
        </li>
        {info.workplace && (
          <li>
            <span>Works at</span>
            <b>{info.workplace}</b>
          </li>
        )}
        {info.job && <JobPicker id={info.id} job={info.job} controller={controller} />}
        {info.carrying && (
          <li>
            <span>Carrying</span>
            <b>{info.carrying}</b>
          </li>
        )}
        <li>
          <span>Mainspring</span>
          <b className={automaton.wind > 1 ? '' : 'warn'}>{automaton.wind > 0 ? `${automaton.wind} months left` : 'Run down: needs coal'}</b>
        </li>
      </ul>
      <NeedBar label="Wound" value={automaton.wind / automaton.windMonths} color="var(--brass-hi)" />
      <p className="muted small">Automatons never eat, freeze or need a home. They wind themselves with coal from storage and seize up after years of service.</p>
      <div className="row">
        <Button size="sm" variant="iron" icon="eye" onClick={() => controller.focusCitizen(info.id)}>
          Follow
        </Button>
      </div>
    </>
  )
}
