import { useState } from 'react'
import { useLoadedContent } from '../../api/content'
import type { GameController } from '../../game/GameController'
import { storyText } from '../../game/sim/story'
import type { HudState, ResearchRow } from '../../state/game'
import { Button, Modal, Panel, ProgressBar } from '../../ui/components'
import { Icon } from '../../ui/Icon'

const STATUS_LABEL: Record<ResearchRow['status'], string> = {
  done: 'Researched',
  current: 'On the drafting tables',
  queued: 'Planned',
  available: 'Available',
  locked: 'Needs earlier research',
  salvage: 'Salvage only: an expedition must find the plans',
}

/** The research tree, one column per tier. Clicking a project plans it (with any missing requirements first). */
export function ResearchPanel({ hud, controller, onClose }: { hud: HudState; controller: GameController; onClose: () => void }) {
  const tiers = [...new Set(hud.research.map((r) => r.tier))].sort((a, b) => a - b)
  const byId = new Map(hud.research.map((r) => [r.id, r]))
  const [focus, setFocus] = useState<string | null>(hud.research.find((r) => r.status === 'current')?.id ?? null)
  const selected = focus ? byId.get(focus) : undefined
  const queue = hud.research.filter((r) => r.status === 'current' || r.status === 'queued')

  return (
    <Modal title="Drafting Office: Research" onClose={onClose} wide>
      <p className="muted small">
        Engineers at a Drafting Office (and later an Analytical Engine) earn research points for the project on the drafting tables. Choose any
        project: unfinished requirements are planned first.
      </p>
      <div className="research-tree">
        {tiers.map((tier) => (
          <div key={tier} className="research-tier">
            {hud.research
              .filter((r) => r.tier === tier)
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`research-card research-${r.status} ${focus === r.id ? 'focused' : ''}`}
                  onClick={() => setFocus(r.id)}
                  onDoubleClick={() => r.status !== 'done' && controller.perform({ type: 'research', tech: r.id })}
                  title={r.description}
                >
                  <b>{r.name}</b>
                  {r.status === 'done' ? (
                    <span className="research-state">
                      <Icon name="check" size={13} /> Researched
                    </span>
                  ) : (
                    <ProgressBar value={r.progress} max={r.points} label={`${Math.floor(r.progress)} / ${r.points}`} />
                  )}
                </button>
              ))}
          </div>
        ))}
      </div>

      {selected && (
        <Panel className="research-detail">
          <h4 className="engraved">{selected.name}</h4>
          <p className="small">{selected.description}</p>
          <ul className="kv">
            <li>
              <span>Status</span>
              <b>{STATUS_LABEL[selected.status]}</b>
            </li>
            <li>
              <span>Cost</span>
              <b>{selected.points} research points</b>
            </li>
            {selected.requires.length > 0 && (
              <li>
                <span>Requires</span>
                <b>{selected.requires.map((id) => byId.get(id)?.name ?? id).join(', ')}</b>
              </li>
            )}
            <li>
              <span>Unlocks</span>
              <b>{selected.unlocks.join(', ') || 'Nothing new'}</b>
            </li>
          </ul>
          {selected.status !== 'done' && selected.status !== 'salvage' && (
            <div className="row">
              <Button size="sm" icon="flask" disabled={selected.status === 'current'} onClick={() => controller.perform({ type: 'research', tech: selected.id })}>
                {selected.status === 'current' ? 'Researching' : 'Research this'}
              </Button>
            </div>
          )}
        </Panel>
      )}

      <div className="research-queue small">
        <span className="muted">Plan:</span>
        {queue.length === 0 ? (
          <span className="warn">Nothing planned. The engineers will labour instead.</span>
        ) : (
          queue.map((r, i) => (
            <span key={r.id} className="research-queue-item">
              {i > 0 && <Icon name="forward" size={11} />} {r.name}
            </span>
          ))
        )}
        {queue.length > 0 && (
          <Button size="sm" variant="ghost" icon="close" onClick={() => controller.perform({ type: 'clearResearch' })}>
            Clear
          </Button>
        )}
      </div>
    </Modal>
  )
}

/** Letters from the Company: the founding charter and every dispatch received so far. */
export function DispatchPanel({ hud, initial, onClose }: { hud: HudState; initial?: string; onClose: () => void }) {
  const content = useLoadedContent()
  const story = content.bundle.story
  const received = hud.dispatches.map((id) => story.dispatches.find((d) => d.id === id)).filter((d) => d !== undefined)
  const [open, setOpen] = useState<string>(initial ?? received.at(-1)?.id ?? 'charter')
  const letter = received.find((d) => d.id === open)
  // Three volumes: the Board's dispatches, telegrams from the answering forges, and the papers found in the ruins.
  const volumes: [string, typeof received][] = [
    ['From the Board', received.filter((d) => (d.volume ?? 'board') === 'board')],
    ['Telegrams', received.filter((d) => d.volume === 'telegrams')],
    ['The Forge Papers', received.filter((d) => d.volume === 'papers')],
  ]

  return (
    <Modal title="Dispatches from the Company" onClose={onClose} wide>
      <div className="dispatch-layout">
        <ul className="dispatch-list">
          <li>
            <button type="button" className={open === 'charter' ? 'active' : ''} onClick={() => setOpen('charter')}>
              <Icon name="book" size={14} /> {story.intro.title}
            </button>
          </li>
          {volumes.map(([volume, letters]) =>
            letters.length === 0 ? null : (
              <li key={volume} className="dispatch-volume">
                <span className="dispatch-volume-title">{volume}</span>
                <ul>
                  {letters.map((d) => (
                    <li key={d.id}>
                      <button type="button" className={open === d.id ? 'active' : ''} onClick={() => setOpen(d.id)}>
                        <Icon name="book" size={14} /> {d.title.replace(/^(Dispatch|Telegram from|Telegram|The Forge Papers): ?/, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
        {letter ? (
          <Letter title={letter.title} paragraphs={[storyText(letter.text, hud.colonyName)]} signature={letter.from ?? 'The Board, Meridian Steam Company'} />
        ) : (
          <Letter title={story.intro.title} paragraphs={story.intro.paragraphs.map((p) => storyText(p, hud.colonyName))} signature={story.intro.signature} />
        )}
      </div>
    </Modal>
  )
}

function Letter({ title, paragraphs, signature }: { title: string; paragraphs: string[]; signature: string }) {
  return (
    <Panel variant="parchment" className="letter">
      <h3 className="letter-title">{title}</h3>
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className="letter-signature">{signature}</p>
    </Panel>
  )
}

/** The founding charter, shown once when a colony is founded. The game waits paused behind it. */
export function Charter({ hud, onClose }: { hud: HudState; onClose: () => void }) {
  const content = useLoadedContent()
  const intro = content.bundle.story.intro
  return (
    <div className="modal-scrim charter-scrim">
      <div className="charter">
        <Letter title={intro.title} paragraphs={intro.paragraphs.map((p) => storyText(p, hud.colonyName))} signature={intro.signature} />
        <div className="charter-actions">
          <Button size="lg" icon="play" onClick={onClose}>
            Light the Steamforge
          </Button>
        </div>
      </div>
    </div>
  )
}
