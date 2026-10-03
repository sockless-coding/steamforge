// Test-only helpers: loads the real server content from disk so simulation tests exercise shipped data.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexContent, type Content } from '../../api/content'
import type { ContentBundle } from '../../api/types'
import { Simulation } from './simulation'
import type { NewColonyOptions } from './types'

const contentDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../SF.Application/Content')

function read<T>(kind: string): T {
  return JSON.parse(readFileSync(resolve(contentDir, `${kind}.json`), 'utf8')) as T
}

export const bundle: ContentBundle = {
  version: 'test',
  rules: read('rules'),
  resources: read('resources'),
  features: read('features'),
  buildings: read('buildings'),
  recipes: read('recipes'),
  crops: read('crops'),
  professions: read('professions'),
  events: read('events'),
  difficulty: read('difficulty'),
  mapgen: read('mapgen'),
  research: read('research'),
  story: read('story'),
}

export const content: Content = indexContent(bundle)

export function newColony(overrides: Partial<NewColonyOptions> = {}): Simulation {
  return Simulation.create(content, { seed: 1234, name: 'Testford', difficulty: 'engineer', mapSize: 'small', terrain: 'valley', ...overrides })
}

export function runSeconds(sim: Simulation, seconds: number): void {
  const ticks = Math.round(seconds * sim.tps)
  for (let i = 0; i < ticks && sim.outcome === 'playing'; i++) sim.step()
}

export function runMonths(sim: Simulation, months: number): void {
  runSeconds(sim, months * sim.rules.secondsPerMonth)
}
