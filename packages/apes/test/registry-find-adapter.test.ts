import { describe, expect, it } from 'vitest'
import { findAdapter } from '../src/shapes/registry.js'
import type { RegistryIndex } from '../src/shapes/types.js'

// Minimal fake index — only the fields `findAdapter` looks at.
const fakeIndex: RegistryIndex = {
  version: 1,
  generated_at: '2026-01-01T00:00:00Z',
  adapters: [
    { id: 'rm', executable: 'rm' },
    { id: 'o365', executable: 'o365-cli' },
    { id: 'o365mail', executable: 'o365-mail-cli' },
  ] as RegistryIndex['adapters'],
}

describe('findAdapter', () => {
  it('matches by registry id', () => {
    const entry = findAdapter(fakeIndex, 'o365')
    expect(entry?.id).toBe('o365')
  })

  it('matches by executable when id differs', () => {
    const entry = findAdapter(fakeIndex, 'o365-cli')
    expect(entry?.id).toBe('o365')
    expect(entry?.executable).toBe('o365-cli')
  })

  it('matches the correct adapter when two share a prefix', () => {
    const entry = findAdapter(fakeIndex, 'o365-mail-cli')
    expect(entry?.id).toBe('o365mail')
  })

  it('matches by id when id equals executable', () => {
    const entry = findAdapter(fakeIndex, 'rm')
    expect(entry?.id).toBe('rm')
  })

  it('returns undefined for an unknown key', () => {
    expect(findAdapter(fakeIndex, 'definitely-not-there')).toBeUndefined()
  })
})
