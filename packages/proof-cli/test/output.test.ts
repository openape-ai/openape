import { afterEach, describe, expect, it, vi } from 'vitest'
import { error, info } from '../src/output'

function captureStderr(): string[] {
  const lines: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk))
    return true
  })
  return lines
}

afterEach(() => vi.restoreAllMocks())

describe('proof-cli output helpers', () => {
  it('info writes to stderr and respects --quiet', () => {
    const lines = captureStderr()
    info('hello')
    info('suppressed', { quiet: true })
    expect(lines).toEqual(['hello\n'])
  })

  it('error prefixes the message', () => {
    const lines = captureStderr()
    error('boom')
    expect(lines).toEqual(['error: boom\n'])
  })
})
