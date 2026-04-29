import { describe, expect, it } from 'vitest'
import { matchSecret } from '../src/secrets-match.js'
import type { SecretEntry } from '../src/types.js'

function entry(name: string, target: string): SecretEntry {
  return {
    name,
    target,
    header: 'Authorization',
    template: `Bearer \${value}`,
    value: 'v',
  }
}

describe('matchSecret', () => {
  it('returns null when nothing matches', () => {
    expect(matchSecret(new URL('https://other.com/x'), [entry('gh', 'api.github.com/*')])).toBeNull()
  })

  it('matches simple host glob', () => {
    const e = entry('gh', 'api.github.com/*')
    expect(matchSecret(new URL('https://api.github.com/repos'), [e])?.name).toBe('gh')
  })

  it('prefers longer literal prefix over shorter', () => {
    const broad = entry('broad', 'api.github.com/*')
    const narrow = entry('narrow', 'api.github.com/repos/*')
    expect(matchSecret(new URL('https://api.github.com/repos/x'), [broad, narrow])?.name).toBe('narrow')
  })

  it('uses file order as tiebreak when prefixes are equal', () => {
    const a = entry('first', 'api.github.com/*')
    const b = entry('second', 'api.github.com/*')
    // Note: this would be rejected by the dup-target check in parseSecretsBlob,
    // but matchSecret itself must be deterministic if called with such input.
    expect(matchSecret(new URL('https://api.github.com/x'), [a, b])?.name).toBe('first')
  })

  it('matches host:port', () => {
    const e = entry('smtp', 'smtp.fastmail.com:587')
    expect(matchSecret(new URL('http://smtp.fastmail.com:587/'), [e])?.name).toBe('smtp')
  })
})
