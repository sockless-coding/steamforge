import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteCloudSave, getCloudSave, useCloudSaves } from '../api/saves'
import { decodeSnapshot, deleteLocalSave, listLocalSaves, readLocalSave } from '../lib/saves'
import { useAuth } from '../state/auth'
import { usePendingGame } from '../state/pending'
import { Button, GearBackdrop, Panel, ScreenHeader } from '../ui/components'
import './screens.css'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function LoadScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signedIn = useAuth((s) => s.session !== null)
  const local = useQuery({ queryKey: ['local-saves'], queryFn: listLocalSaves })
  const cloud = useCloudSaves()
  const setPending = usePendingGame((s) => s.set)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = async (key: string, read: () => Promise<string | undefined>) => {
    setBusy(key)
    setError(null)
    try {
      const data = await read()
      if (!data) throw new Error('The save could not be read.')
      setPending({ mode: 'load', snapshot: await decodeSnapshot(data) })
      navigate('/play')
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="screen">
      <GearBackdrop />
      <ScreenHeader title="Load a Colony" />
      <div className="screen-scroll saves">
        {error && <p className="error-text">{error}</p>}
        <Panel title="On this device">
          {local.data?.length ? (
            <ul className="save-list">
              {local.data.map((s) => (
                <li key={s.id}>
                  <div>
                    <b>{s.name}</b> {s.id === 'auto' && <span className="chip">Autosave</span>}
                    <span className="muted small">
                      {s.summary} · {when(s.updatedAt)}
                    </span>
                  </div>
                  <Button size="sm" icon="play" disabled={busy !== null} onClick={() => void open(s.id, () => readLocalSave(s.id))}>
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label="Delete"
                    onClick={() => void deleteLocalSave(s.id).then(() => queryClient.invalidateQueries({ queryKey: ['local-saves'] }))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No colonies saved on this device yet.</p>
          )}
        </Panel>
        <Panel title="Cloud">
          {!signedIn ? (
            <p className="muted">Sign in to keep colonies in the cloud and continue them on any device.</p>
          ) : cloud.data?.length ? (
            <ul className="save-list">
              {cloud.data.map((s) => (
                <li key={s.slot}>
                  <div>
                    <b>
                      Slot {s.slot}: {s.name}
                    </b>
                    <span className="muted small">
                      {s.summary} · {when(s.updatedAt)}
                    </span>
                  </div>
                  <Button size="sm" icon="play" disabled={busy !== null} onClick={() => void open(`cloud-${s.slot}`, async () => (await getCloudSave(s.slot)).data)}>
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label="Delete"
                    onClick={() => void deleteCloudSave(s.slot).then(() => queryClient.invalidateQueries({ queryKey: ['saves'] }))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{cloud.isLoading ? 'Fetching saves…' : 'No cloud saves yet.'}</p>
          )}
        </Panel>
      </div>
    </div>
  )
}
