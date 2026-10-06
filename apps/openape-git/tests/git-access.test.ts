import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it } from 'vitest'
import {
  accessAllows,
  accessFromGrants,
  accessFromScopes,
  isValidOwner,
  isValidRepoName,
  parseGitHttpPath,
  requiredAccess,
  requiredAccessFor,
} from '../server/utils/git-access'

const AUD = 'repos.openape.ai'
const NOW = 1_700_000_000

function grant(overrides: {
  delegate?: string
  scopes?: string[]
  status?: OpenApeGrant['status']
  audience?: string
  grantType?: 'timed' | 'always'
  expiresAt?: number
}): OpenApeGrant {
  return {
    id: 'g1',
    type: 'delegation',
    status: overrides.status ?? 'approved',
    created_at: NOW - 100,
    expires_at: overrides.expiresAt,
    request: {
      requester: 'owner@example.com',
      target_host: AUD,
      audience: overrides.audience ?? AUD,
      grant_type: overrides.grantType ?? 'always',
      delegator: 'owner@example.com',
      delegate: overrides.delegate ?? 'agent@example.com',
      scopes: overrides.scopes ?? ['git:read', 'repo:patrick/app'],
    },
  }
}

describe('parseGitHttpPath', () => {
  it('parses owner, name and rest', () => {
    expect(parseGitHttpPath('/patrick/app.git/info/refs')).toEqual({ owner: 'patrick', name: 'app', rest: '/info/refs' })
    expect(parseGitHttpPath('/patrick/app.git')).toEqual({ owner: 'patrick', name: 'app', rest: '' })
  })

  it('ignores non-git paths and rejects traversal', () => {
    expect(parseGitHttpPath('/api/repos')).toBeNull()
    expect(parseGitHttpPath('/repos/patrick/app')).toBeNull()
    expect(parseGitHttpPath('/../etc/passwd.git/info/refs')).toBeNull()
    expect(parseGitHttpPath('/patrick/..%2f.git/info/refs')).toBeNull()
  })
})

describe('name validation', () => {
  it('accepts normal slugs', () => {
    expect(isValidOwner('patrick')).toBe(true)
    expect(isValidRepoName('openape-monorepo')).toBe(true)
    expect(isValidRepoName('my.repo_2')).toBe(true)
  })

  it('rejects traversal, dot-leading and .git names', () => {
    expect(isValidOwner('..')).toBe(false)
    expect(isValidOwner('a/b')).toBe(false)
    expect(isValidRepoName('..')).toBe(false)
    expect(isValidRepoName('.hidden')).toBe(false)
    expect(isValidRepoName('foo.git')).toBe(false)
    expect(isValidRepoName('a/b')).toBe(false)
  })
})

describe('requiredAccess', () => {
  it('write for receive-pack, read otherwise', () => {
    expect(requiredAccess('git-receive-pack')).toBe('write')
    expect(requiredAccess('git-upload-pack')).toBe('read')
    expect(requiredAccess(null)).toBe('read')
  })
})

describe('accessFromScopes', () => {
  it('needs the repo scope AND a git level', () => {
    expect(accessFromScopes(['git:write', 'repo:patrick/app'], 'patrick', 'app')).toBe('write')
    expect(accessFromScopes(['git:write'], 'patrick', 'app')).toBeNull()
    expect(accessFromScopes(['repo:patrick/app'], 'patrick', 'app')).toBeNull()
    expect(accessFromScopes(['git:write', 'repo:patrick/other'], 'patrick', 'app')).toBeNull()
  })

  it('picks the highest level', () => {
    expect(accessFromScopes(['git:read', 'git:admin', 'repo:patrick/app'], 'patrick', 'app')).toBe('admin')
  })
})

describe('accessFromGrants — the refusals matter most', () => {
  it('grants read access for an approved grant', () => {
    expect(accessFromGrants([grant({})], 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBe('read')
  })

  it('refuses a revoked grant', () => {
    expect(accessFromGrants([grant({ status: 'revoked' })], 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBeNull()
  })

  it('refuses an expired timed grant', () => {
    const g = grant({ grantType: 'timed', expiresAt: NOW - 1 })
    expect(accessFromGrants([g], 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBeNull()
  })

  it('still honors a timed grant before expiry', () => {
    const g = grant({ grantType: 'timed', expiresAt: NOW + 60 })
    expect(accessFromGrants([g], 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBe('read')
  })

  it('refuses a grant for another delegate, audience or repo', () => {
    expect(accessFromGrants([grant({})], 'other@example.com', 'patrick', 'app', AUD, NOW)).toBeNull()
    expect(accessFromGrants([grant({ audience: 'elsewhere' })], 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBeNull()
    expect(accessFromGrants([grant({})], 'agent@example.com', 'patrick', 'other', AUD, NOW)).toBeNull()
  })

  it('read grant does not allow push', () => {
    const access = accessFromGrants([grant({})], 'agent@example.com', 'patrick', 'app', AUD, NOW)
    expect(access).toBe('read')
    expect(accessAllows(access!, requiredAccess('git-receive-pack'))).toBe(false)
  })

  it('takes the best of several grants', () => {
    const grants = [grant({}), grant({ scopes: ['git:write', 'repo:patrick/app'] })]
    expect(accessFromGrants(grants, 'agent@example.com', 'patrick', 'app', AUD, NOW)).toBe('write')
  })
})

describe('requiredAccessFor', () => {
  it('treats a receive-pack path as a write even when the service param says otherwise', () => {
    // Regression: `?service=` used to win over the path, so a git:read grant
    // could push via POST /o/r.git/git-receive-pack?service=git-upload-pack.
    expect(requiredAccessFor('/o/r.git/git-receive-pack', 'git-upload-pack')).toBe('write')
  })

  it('treats the push advertisement as a write', () => {
    expect(requiredAccessFor('/o/r.git/info/refs', 'git-receive-pack')).toBe('write')
  })

  it('leaves clone and fetch at read', () => {
    expect(requiredAccessFor('/o/r.git/info/refs', 'git-upload-pack')).toBe('read')
    expect(requiredAccessFor('/o/r.git/git-upload-pack', null)).toBe('read')
  })
})
