import { useQuery } from '@tanstack/react-query'
import { idb } from '../lib/storage'
import { OfflineError, rawRequest } from './http'
import type {
  BuildingDef,
  ContentBundle,
  CropDef,
  DifficultyPreset,
  EventDef,
  FeatureDef,
  ProfessionDef,
  RecipeDef,
  ResearchDef,
  ResourceDef,
} from './types'

const CACHE_KEY = 'content-bundle'

/** The server-authored content bundle plus lookup tables. Immutable once built. */
export interface Content {
  bundle: ContentBundle
  resources: Map<string, ResourceDef>
  features: Map<string, FeatureDef>
  buildings: Map<string, BuildingDef>
  recipes: Map<string, RecipeDef>
  crops: Map<string, CropDef>
  professions: Map<string, ProfessionDef>
  events: Map<string, EventDef>
  presets: Map<string, DifficultyPreset>
  research: Map<string, ResearchDef>
  /** The headquarters building (the Steamforge). */
  headquarters: BuildingDef
}

export function indexContent(bundle: ContentBundle): Content {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]))
  return {
    bundle,
    resources: byId(bundle.resources),
    features: byId(bundle.features),
    buildings: byId(bundle.buildings),
    recipes: byId(bundle.recipes),
    crops: byId(bundle.crops),
    professions: byId(bundle.professions),
    events: byId(bundle.events),
    presets: byId(bundle.difficulty.presets),
    research: byId(bundle.research),
    headquarters: bundle.buildings.find((b) => b.headquarters) ?? bundle.buildings[0],
  }
}

/**
 * Loads content with an ETag revalidation against the IndexedDB copy, so repeat launches transfer nothing and the
 * game still boots offline with the last known content.
 */
export async function loadContent(): Promise<Content> {
  const cached = await idb.get<ContentBundle>(CACHE_KEY)
  try {
    const response = await rawRequest('/api/content', {
      auth: false,
      headers: cached ? { 'If-None-Match': `"${cached.version}"` } : {},
    })
    if (response.status === 304 && cached) {
      return indexContent(cached)
    }
    if (!response.ok) {
      throw new Error(`Content request failed (${response.status})`)
    }
    const bundle = (await response.json()) as ContentBundle
    void idb.set(CACHE_KEY, bundle)
    return indexContent(bundle)
  } catch (error) {
    if (cached && (error instanceof OfflineError || error instanceof Error)) {
      return indexContent(cached)
    }
    throw error
  }
}

export function useContent() {
  return useQuery({ queryKey: ['content'], queryFn: loadContent, staleTime: Infinity, gcTime: Infinity })
}

/** For components rendered below the content gate in the app shell. */
export function useLoadedContent(): Content {
  const { data } = useContent()
  if (!data) {
    throw new Error('Content accessed before it was loaded.')
  }
  return data
}
