import type { GameController } from '../../game/GameController'
import type { BuildingInfo, CitizenInfo } from '../../state/game'
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
                  <li key={w.id}>
                    <button type="button" onClick={() => controller.focusCitizen(w.id)}>
                      {w.name}
                    </button>
                  </li>
                ))}
              </ul>
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
          {info.canDemolish && (
            <div className="row">
              <Button size="sm" variant="danger" icon="trash" onClick={() => controller.demolishSelected()}>
                Demolish
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}

function CitizenPanel({ info, controller }: { info: CitizenInfo; controller: GameController }) {
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
