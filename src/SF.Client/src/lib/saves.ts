import type { ColonySnapshot } from '../game/sim/simulation'
import { base64ToBytes, bytesToBase64 } from '../game/sim/codec'
import { idb } from './storage'

/** Snapshot → JSON → gzip → base64. Large maps shrink from megabytes to a few hundred kilobytes. */
export async function encodeSnapshot(snapshot: ColonySnapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(snapshot))
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return bytesToBase64(bytes)
}

export async function decodeSnapshot(data: string): Promise<ColonySnapshot> {
  const bytes = base64ToBytes(data)
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as ColonySnapshot
}

export interface SaveMeta {
  name: string
  summary: string
  difficulty: string
  year: number
  population: number
  contentVersion: string
  saveVersion: number
}

export interface LocalSave extends SaveMeta {
  id: string
  updatedAt: string
  sizeBytes: number
}

export const AUTOSAVE_ID = 'auto'
export const LOCAL_SLOTS = ['local-1', 'local-2', 'local-3']
const INDEX_KEY = 'saves-index'

export async function listLocalSaves(): Promise<LocalSave[]> {
  const index = (await idb.get<LocalSave[]>(INDEX_KEY)) ?? []
  return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function writeLocalSave(id: string, meta: SaveMeta, data: string): Promise<void> {
  await idb.set(`save:${id}`, data)
  const index = ((await idb.get<LocalSave[]>(INDEX_KEY)) ?? []).filter((s) => s.id !== id)
  index.push({ ...meta, id, updatedAt: new Date().toISOString(), sizeBytes: Math.round((data.length * 3) / 4) })
  await idb.set(INDEX_KEY, index)
}

export async function readLocalSave(id: string): Promise<string | undefined> {
  return idb.get<string>(`save:${id}`)
}

export async function deleteLocalSave(id: string): Promise<void> {
  await idb.set(`save:${id}`, null)
  const index = ((await idb.get<LocalSave[]>(INDEX_KEY)) ?? []).filter((s) => s.id !== id)
  await idb.set(INDEX_KEY, index)
}
