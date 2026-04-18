import type { OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { InMemoryGrantStore } from '../src/stores.js'
import { canonicalizeCliPermission } from '../src/cli-permissions.js'
import {
  evaluateStandingGrants,
  isStandingGrantRequest,
  type StandingGrantRequest,
} from '../src/standing-grants.js'

function makeStandingGrant(
  overrides: Partial<StandingGrantRequest> & Pick<StandingGrantRequest, 'owner' | 'delegate' | 'resource_chain_template'>,
): OpenApeGrant {
  const req: StandingGrantRequest = {
    type: 'standing',
    audience: 'shapes',
    grant_type: 'always',
    ...overrides,
  }
  return {
    id: `sg-${Math.random().toString(36).slice(2, 10)}`,
    status: 'approved',
    // @ts-expect-error — OpenApeGrant.request is typed as OpenApeGrantRequest but
    // standing grants use StandingGrantRequest; the DB stores it verbatim.
    request: req,
    created_at: Math.floor(Date.now() / 1000) - 60,
    decided_at: Math.floor(Date.now() / 1000) - 30,
    decided_by: overrides.owner,
  }
}

function makeIncomingGrantRequest(
  overrides: Partial<OpenApeGrantRequest> = {},
): OpenApeGrantRequest {
  const detail = {
    type: 'openape_cli' as const,
    cli_id: 'git',
    operation_id: 'git.clone',
    resource_chain: [{ resource: 'repo', selector: { owner: 'patrick', name: 'app' } }],
    action: 'exec',
    permission: '',
    display: 'Clone patrick/app',
    risk: 'medium' as const,
  }
  detail.permission = canonicalizeCliPermission(detail)
  return {
    requester: 'claude@example.com',
    target_host: 'macmini',
    audience: 'shapes',
    grant_type: 'once',
    authorization_details: [detail],
    ...overrides,
  }
}

describe('isStandingGrantRequest', () => {
  it('returns true for a valid standing grant request', () => {
    expect(isStandingGrantRequest({
      type: 'standing',
      owner: 'patrick@',
      delegate: 'claude@',
      audience: 'shapes',
      resource_chain_template: [],
      grant_type: 'always',
    })).toBe(true)
  })

  it('returns false for non-standing requests', () => {
    expect(isStandingGrantRequest({ type: 'command' })).toBe(false)
    expect(isStandingGrantRequest(null)).toBe(false)
    expect(isStandingGrantRequest(undefined)).toBe(false)
    expect(isStandingGrantRequest({})).toBe(false)
  })
})

describe('evaluateStandingGrants', () => {
  async function withStandingGrants(sgs: OpenApeGrant[]) {
    const store = new InMemoryGrantStore()
    for (const sg of sgs) await store.save(sg)
    return store
  }

  it('matches when template owner selector covers incoming', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        resource_chain_template: [{ resource: 'repo', selector: { owner: 'patrick' } }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).not.toBeNull()
    expect(match!.standing_grant_id).toMatch(/^sg-/)
  })

  it('matches with wildcard selector (no selector in template)', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        resource_chain_template: [{ resource: 'repo' }], // no selector = wildcard
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).not.toBeNull()
  })

  it('does not match when delegate differs', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'someone-else@',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('does not match when audience differs', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        audience: 'escapes',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('does not match when target_host is set and differs', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        target_host: 'other-host',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('matches when target_host is unset (wildcard host)', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).not.toBeNull()
  })

  it('does not match when cli_id restriction differs', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        cli_id: 'kubectl', // incoming is git
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('does not match when max_risk is below incoming risk', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        max_risk: 'low', // incoming is medium
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('matches when max_risk is at or above incoming risk', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        max_risk: 'high',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).not.toBeNull()
  })

  it('does not match when template has a selector that does not cover incoming', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        resource_chain_template: [{ resource: 'repo', selector: { owner: 'someone-else' } }],
      }),
    ])
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('ignores non-standing grants', async () => {
    const store = new InMemoryGrantStore()
    // A normal approved grant, not a standing grant, should not be a match source.
    await store.save({
      id: 'regular',
      status: 'approved',
      request: {
        requester: 'claude@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'always',
        authorization_details: [],
      },
      created_at: 0,
      decided_at: 0,
    })
    const match = await evaluateStandingGrants(makeIncomingGrantRequest(), store)
    expect(match).toBeNull()
  })

  it('returns null for a grant request with no CLI authorization details', async () => {
    const store = await withStandingGrants([
      makeStandingGrant({
        owner: 'patrick@',
        delegate: 'claude@example.com',
        resource_chain_template: [{ resource: 'repo' }],
      }),
    ])
    const match = await evaluateStandingGrants(
      makeIncomingGrantRequest({ authorization_details: [] }),
      store,
    )
    expect(match).toBeNull()
  })
})
