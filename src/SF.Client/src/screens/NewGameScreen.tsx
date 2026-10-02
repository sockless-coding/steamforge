import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { playAsGuest } from '../api/account'
import { useLoadedContent } from '../api/content'
import { hashString } from '../game/sim/rng'
import { useAuth } from '../state/auth'
import { usePendingGame } from '../state/pending'
import { Button, GearBackdrop, Panel, ScreenHeader, Tabs } from '../ui/components'
import { Icon } from '../ui/Icon'
import './screens.css'

const PREFIXES = ['Brass', 'Copper', 'Cog', 'Kettle', 'Rivet', 'Smoke', 'Iron', 'Ember', 'Steam', 'Gear', 'Piston', 'Coal']
const SUFFIXES = ['bury', 'ford', 'haven', 'wick', 'ton', 'hollow', 'stead', 'mouth', 'gate', 'worth', 'field', 'moor']

function randomName(): string {
  return PREFIXES[Math.floor(Math.random() * PREFIXES.length)] + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]
}

function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}

/** Founding options: name, Banished-style difficulty preset, map size, terrain type and seed. */
export function NewGameScreen() {
  const navigate = useNavigate()
  const content = useLoadedContent()
  const gen = content.bundle.mapgen
  const presets = [...content.bundle.difficulty.presets].sort((a, b) => a.order - b.order)
  const setPending = usePendingGame((s) => s.set)
  const session = useAuth((s) => s.session)
  const [name, setName] = useState(randomName)
  const [difficulty, setDifficulty] = useState(content.bundle.difficulty.defaultPreset)
  const [size, setSize] = useState(gen.defaultSize)
  const [terrain, setTerrain] = useState(gen.defaultTerrain)
  const [seed, setSeed] = useState(randomSeed)
  const preset = content.presets.get(difficulty)!

  const start = () => {
    // A silent guest account enables cloud saves and records; play continues offline if it fails.
    if (!session) void playAsGuest().catch(() => undefined)
    const numeric = /^\d+$/.test(seed) ? Number(seed) >>> 0 : hashString(seed)
    setPending({ mode: 'new', options: { seed: numeric, name: name.trim() || randomName(), difficulty, mapSize: size, terrain } })
    navigate('/play')
  }

  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`

  return (
    <div className="screen">
      <GearBackdrop />
      <ScreenHeader title="Found a Colony" />
      <div className="screen-scroll new-game">
        <Panel title="Colony">
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Seed</span>
            <div className="seed-row">
              <input value={seed} maxLength={24} onChange={(e) => setSeed(e.target.value)} />
              <Button size="sm" variant="iron" icon="gear" onClick={() => setSeed(randomSeed())} aria-label="New seed" />
            </div>
          </label>
        </Panel>

        <Panel title="Difficulty">
          <div className="difficulty-presets">
            {presets.map((p) => (
              <button key={p.id} type="button" className={`difficulty-preset ${p.id === difficulty ? 'selected' : ''}`} onClick={() => setDifficulty(p.id)}>
                <b>{p.name}</b>
                <span className="difficulty-desc">{p.description}</span>
                <span className="preset-facts">
                  <span>
                    <Icon name="people" size={14} /> {p.startingFamilies} families
                  </span>
                  <span>
                    <Icon name="snow" size={14} /> Winters {pct(p.modifiers.winterSeverity)}
                  </span>
                  <span>
                    <Icon name="flame" size={14} /> Disasters {pct(p.modifiers.disasterRate)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="muted small">
            {preset.name}: starts with {Object.entries(preset.startingResources).map(([r, q]) => `${q} ${content.resources.get(r)?.name.toLowerCase() ?? r}`).join(', ')}
            {preset.startingBuildings.length > 0 &&
              `, plus ${preset.startingBuildings.map((b) => `${b.count} × ${content.buildings.get(b.id)?.name ?? b.id}`).join(', ')}`}
            .
          </p>
        </Panel>

        <Panel title="Land">
          <Tabs tabs={gen.sizes.map((s) => ({ id: s.id, label: `${s.name} (${s.size}²)` }))} value={size} onChange={setSize} />
          <div className="terrain-options">
            {gen.terrains.map((t) => (
              <button key={t.id} type="button" className={`difficulty-preset ${t.id === terrain ? 'selected' : ''}`} onClick={() => setTerrain(t.id)}>
                <b>{t.name}</b>
                <span className="difficulty-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </Panel>

        <div className="new-game-actions">
          <Button size="lg" icon="play" onClick={start}>
            Found {name.trim() || 'colony'}
          </Button>
        </div>
      </div>
    </div>
  )
}
