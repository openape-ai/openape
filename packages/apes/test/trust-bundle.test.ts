import { describe, expect, it } from 'vitest'

describe('detectSystemCaPath', () => {
  it('returns a path that exists on macOS or Linux', async () => {
    const { detectSystemCaPath } = await import('../src/proxy/trust-bundle')
    const path = detectSystemCaPath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })
})
