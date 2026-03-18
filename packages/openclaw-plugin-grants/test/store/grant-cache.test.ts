import { describe, expect, it, vi } from 'vitest'
import { GrantCache } from '../../src/store/grant-cache.js'
import type { GrantRecord } from '../../src/types.js'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'

function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    id: 'test-1',
    permission: 'gh.owner[login=openape].repo[*]#list',
    approval: 'timed',
    status: 'approved',
    command: 'gh repo list openape',
    risk: 'low',
    display: 'List repos',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeDetail(overrides: Partial<OpenApeCliAuthorizationDetail> = {}): OpenApeCliAuthorizationDetail {
  return {
    type: 'openape_cli',
    cli_id: 'gh',
    operation_id: 'repo.list',
    resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
    action: 'list',
    permission: 'gh.owner[login=openape].repo[*]#list',
    display: 'List repos',
    risk: 'low',
    ...overrides,
  }
}

describe('GrantCache', () => {
  it('caches timed grants', () => {
    const cache = new GrantCache()
    const grant = makeGrant({ expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    const detail = makeDetail()

    cache.put(grant, detail)
    expect(cache.size()).toBe(1)

    const found = cache.lookup(grant.permission, detail)
    expect(found).not.toBeNull()
    expect(found!.id).toBe('test-1')
  })

  it('caches always grants', () => {
    const cache = new GrantCache()
    const grant = makeGrant({ approval: 'always' })
    const detail = makeDetail()

    cache.put(grant, detail)
    expect(cache.lookup(grant.permission, detail)).not.toBeNull()
  })

  it('does not cache once grants', () => {
    const cache = new GrantCache()
    const grant = makeGrant({ approval: 'once' })
    const detail = makeDetail()

    cache.put(grant, detail)
    expect(cache.size()).toBe(0)
  })

  it('evicts expired entries', () => {
    const cache = new GrantCache()
    const grant = makeGrant({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const detail = makeDetail()

    cache.put(grant, detail)
    const found = cache.lookup(grant.permission, detail)
    expect(found).toBeNull()
    expect(cache.size()).toBe(0) // evicted
  })

  it('finds covering grants via authorization detail coverage', () => {
    const cache = new GrantCache()

    // Grant for all repos under openape
    const wideGrant = makeGrant({
      id: 'wide',
      permission: 'gh.owner[login=openape].repo[*]#list',
      approval: 'always',
    })
    const wideDetail = makeDetail({
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
    })
    cache.put(wideGrant, wideDetail)

    // Lookup for a specific repo under same owner
    const specificDetail = makeDetail({
      permission: 'gh.owner[login=openape].repo[name=core]#list',
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'core' } },
      ],
    })

    const found = cache.lookup('gh.owner[login=openape].repo[name=core]#list', specificDetail)
    expect(found).not.toBeNull()
    expect(found!.id).toBe('wide')
  })

  it('removes entries', () => {
    const cache = new GrantCache()
    const grant = makeGrant({ approval: 'always' })
    cache.put(grant, makeDetail())

    expect(cache.remove(grant.permission)).toBe(true)
    expect(cache.size()).toBe(0)
  })

  it('clears all entries', () => {
    const cache = new GrantCache()
    cache.put(makeGrant({ id: '1', approval: 'always' }), makeDetail())
    cache.put(makeGrant({ id: '2', permission: 'other#list', approval: 'always' }), makeDetail({ permission: 'other#list' }))

    cache.clear()
    expect(cache.size()).toBe(0)
  })
})
