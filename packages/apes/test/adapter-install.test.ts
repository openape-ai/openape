import { describe, expect, it } from 'vitest'

/**
 * Tests for multi-ID argument collection used by `apes adapter install` and
 * `apes adapter remove`. The helper mirrors the logic inside the run() handlers.
 */

function collectIds(argsId: string, argsRest: string[]): string[] {
  return [String(argsId), ...argsRest].filter(Boolean)
}

describe('adapter install — multi-ID argument collection', () => {
  it('collects a single ID', () => {
    expect(collectIds('gh', [])).toEqual(['gh'])
  })

  it('collects multiple IDs from positional + rest args', () => {
    expect(collectIds('gh', ['git', 'ls', 'cat'])).toEqual(['gh', 'git', 'ls', 'cat'])
  })

  it('filters out empty strings', () => {
    expect(collectIds('gh', ['', 'git', ''])).toEqual(['gh', 'git'])
  })

  it('handles empty rest args', () => {
    expect(collectIds('az', [])).toEqual(['az'])
  })
})
