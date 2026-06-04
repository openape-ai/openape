import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

afterEach(() => { vi.resetAllMocks() })

describe('whichBinary', () => {
  it('returns the trimmed absolute path when found', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockReturnValue('/usr/local/bin/apes\n')
    const { whichBinary } = await import('../src/lib/which.js')
    expect(whichBinary('apes')).toBe('/usr/local/bin/apes')
  })

  it('returns null when which exits non-zero', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not found') })
    const { whichBinary } = await import('../src/lib/which.js')
    expect(whichBinary('nope')).toBeNull()
  })
})
