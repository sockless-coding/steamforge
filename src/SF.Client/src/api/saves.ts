import { useQuery } from '@tanstack/react-query'
import type { SaveMeta } from '../lib/saves'
import { useAuth } from '../state/auth'
import { api } from './http'
import type { ColonyRecord, SaveDetails, SaveSummary } from './types'

export const CLOUD_SLOTS = 6

export function useCloudSaves() {
  const signedIn = useAuth((s) => s.session !== null)
  return useQuery({
    queryKey: ['saves'],
    queryFn: () => api<SaveSummary[]>('/api/saves'),
    enabled: signedIn,
    staleTime: 10_000,
  })
}

export function getCloudSave(slot: number): Promise<SaveDetails> {
  return api<SaveDetails>(`/api/saves/${slot}`)
}

export function putCloudSave(slot: number, meta: SaveMeta, data: string, expectedVersion: number | null = null): Promise<SaveSummary> {
  return api<SaveSummary>(`/api/saves/${slot}`, { method: 'PUT', body: { ...meta, data, expectedVersion } })
}

export function deleteCloudSave(slot: number): Promise<void> {
  return api(`/api/saves/${slot}`, { method: 'DELETE' })
}

export function reportColony(difficulty: string, founded: boolean, years: number, population: number): Promise<ColonyRecord> {
  return api<ColonyRecord>('/api/stats/colony', { method: 'POST', body: { difficulty, founded, years, population } })
}

export function useColonyRecords() {
  const signedIn = useAuth((s) => s.session !== null)
  return useQuery({ queryKey: ['stats'], queryFn: () => api<ColonyRecord[]>('/api/stats'), enabled: signedIn, staleTime: 30_000 })
}
