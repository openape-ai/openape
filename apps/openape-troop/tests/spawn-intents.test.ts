import { afterEach, describe, expect, it } from 'vitest'
import {
  _internal,
  createSpawnIntent,
  getSpawnIntent,
  resolveSpawnIntent,
} from '../server/utils/spawn-intents'

afterEach(() => {
  _internal.intents.clear()
})

describe('spawn-intents registry', () => {
  it('createSpawnIntent makes the intent pollable with no result yet', () => {
    createSpawnIntent('intent-1')
    const found = getSpawnIntent('intent-1')
    expect(found).toBeDefined()
    expect(found?.result).toBeUndefined()
  })

  it('resolveSpawnIntent attaches a result, ok=true path', () => {
    createSpawnIntent('intent-2')
    resolveSpawnIntent('intent-2', { ok: true, agentEmail: 'foo@example.com' })
    const found = getSpawnIntent('intent-2')
    expect(found?.result?.ok).toBe(true)
    expect(found?.result?.agentEmail).toBe('foo@example.com')
  })

  it('resolveSpawnIntent attaches a result, ok=false path', () => {
    createSpawnIntent('intent-3')
    resolveSpawnIntent('intent-3', { ok: false, error: 'grant denied' })
    expect(getSpawnIntent('intent-3')?.result?.error).toBe('grant denied')
  })

  it('resolveSpawnIntent on an unknown id is a no-op (avoid surprises if nest re-sends)', () => {
    expect(() => resolveSpawnIntent('never-created', { ok: true })).not.toThrow()
    expect(getSpawnIntent('never-created')).toBeUndefined()
  })

  it('getSpawnIntent for unknown id returns undefined', () => {
    expect(getSpawnIntent('nope')).toBeUndefined()
  })
})
