import { describe, expect, it, vi } from 'vitest'
import { buildApesArgs, detectApes } from '../../src/execution/apes.js'

describe('buildApesArgs', () => {
  it('builds correct args for apes', () => {
    const args = buildApesArgs('jwt-token', 'gh', ['pr', 'merge', '42'])
    expect(args).toEqual(['--grant', 'jwt-token', '--', 'gh', 'pr', 'merge', '42'])
  })

  it('handles empty args', () => {
    const args = buildApesArgs('jwt', 'echo', [])
    expect(args).toEqual(['--grant', 'jwt', '--', 'echo'])
  })
})

describe('detectApes', () => {
  it('returns not available for non-existent binary', () => {
    const result = detectApes('/nonexistent/path/apes-test-binary')
    expect(result.available).toBe(false)
  })

  it('returns not available when apes is not in PATH', () => {
    const result = detectApes('apes-nonexistent-test-binary-12345')
    expect(result.available).toBe(false)
  })
})
