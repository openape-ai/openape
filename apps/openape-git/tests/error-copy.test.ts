import { describe, expect, it } from 'vitest'
import { errorCopy } from '../app/utils/error-copy'

describe('errorCopy', () => {
  it('does not tell a stranger whether the repo exists', () => {
    // The API answers 404 both for "no such repo" and "no grant" on purpose.
    // If this copy named access, probing URLs would map the forge.
    const { detail } = errorCopy(404)
    expect(detail).toContain('does not exist')
    expect(detail).toContain('grants')
  })

  it('names access for 403, where existence is already known', () => {
    expect(errorCopy(403).title).toBe('Not allowed')
  })

  it('blames itself for server errors and unmapped statuses', () => {
    expect(errorCopy(500).title).toBe('Something broke')
    expect(errorCopy(418).title).toBe('Something broke')
    expect(errorCopy(undefined).title).toBe('Something broke')
  })
})
