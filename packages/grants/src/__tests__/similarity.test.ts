import type { OpenApeCliAuthorizationDetail, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { findSimilarCliGrants } from '../similarity.js'

function makeCliDetail(overrides: Partial<OpenApeCliAuthorizationDetail> = {}): OpenApeCliAuthorizationDetail {
  return {
    type: 'openape_cli',
    cli_id: 'gh',
    operation_id: 'repo.list',
    resource_chain: [],
    action: 'list',
    permission: '',
    display: 'List repos',
    risk: 'low',
    ...overrides,
  }
}

function makeGrant(overrides: Partial<OpenApeGrant> & { request: OpenApeGrantRequest }): OpenApeGrant {
  return {
    id: crypto.randomUUID(),
    status: 'approved',
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

describe('findSimilarCliGrants', () => {
  const baseRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'shapes',
    grant_type: 'always',
    authorization_details: [makeCliDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'docs' } },
      ],
      permission: 'gh.owner[login=openape].repo[name=docs]#list',
    })],
  }

  const existingGrant = makeGrant({
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'always',
      authorization_details: [makeCliDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'cli' } },
        ],
        permission: 'gh.owner[login=openape].repo[name=cli]#list',
      })],
    },
  })

  it('finds similar grant with different selector', () => {
    const result = findSimilarCliGrants(baseRequest, [existingGrant])
    expect(result).not.toBeNull()
    expect(result!.similar_grants).toHaveLength(1)
    expect(result!.similar_grants[0]!.grant.id).toBe(existingGrant.id)
  })

  it('returns widened preview with wildcard', () => {
    const result = findSimilarCliGrants(baseRequest, [existingGrant])
    expect(result).not.toBeNull()
    const widenedPerms = result!.widened_details.map(d => d.permission)
    expect(widenedPerms).toContain('gh.owner[login=openape].repo[*]#list')
  })

  it('returns merged preview with both specific values', () => {
    const result = findSimilarCliGrants(baseRequest, [existingGrant])
    expect(result).not.toBeNull()
    const mergedPerms = result!.merged_details.map(d => d.permission)
    expect(mergedPerms).toContain('gh.owner[login=openape].repo[name=cli]#list')
    expect(mergedPerms).toContain('gh.owner[login=openape].repo[name=docs]#list')
  })

  it('returns null when no similar grants exist', () => {
    const differentGrant = makeGrant({
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'always',
        authorization_details: [makeCliDetail({
          cli_id: 'npm',
          resource_chain: [{ resource: 'package', selector: { name: 'foo' } }],
          permission: 'npm.package[name=foo]#list',
        })],
      },
    })
    expect(findSimilarCliGrants(baseRequest, [differentGrant])).toBeNull()
  })

  it('excludes expired grants', () => {
    const expired = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      expires_at: Math.floor(Date.now() / 1000) - 100,
      request: { ...existingGrant.request, grant_type: 'timed' },
    })
    expect(findSimilarCliGrants(baseRequest, [expired])).toBeNull()
  })

  it('excludes once grants', () => {
    const once = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, grant_type: 'once' },
    })
    expect(findSimilarCliGrants(baseRequest, [once])).toBeNull()
  })

  it('excludes grants with different requester', () => {
    const differentRequester = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, requester: 'other@example.com' },
    })
    expect(findSimilarCliGrants(baseRequest, [differentRequester])).toBeNull()
  })

  it('excludes grants with different audience', () => {
    const differentAudience = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, audience: 'proxy' },
    })
    expect(findSimilarCliGrants(baseRequest, [differentAudience])).toBeNull()
  })

  it('excludes non-approved grants', () => {
    const pending = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      status: 'pending',
    })
    expect(findSimilarCliGrants(baseRequest, [pending])).toBeNull()
  })

  it('returns null for requests without CLI details', () => {
    const nonCliRequest: OpenApeGrantRequest = {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'proxy',
      permissions: ['read'],
    }
    expect(findSimilarCliGrants(nonCliRequest, [existingGrant])).toBeNull()
  })

  it('excludes grants with different target_host', () => {
    const differentTargetHost = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, target_host: 'other-host' },
    })
    expect(findSimilarCliGrants(baseRequest, [differentTargetHost])).toBeNull()
  })

  it('excludes grants with different run_as', () => {
    const withRunAs = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, run_as: 'some-user' },
    })
    expect(findSimilarCliGrants(baseRequest, [withRunAs])).toBeNull()
  })

  it('excludes grants with different delegator', () => {
    const withDelegator = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, delegator: 'someone@example.com' },
    })
    expect(findSimilarCliGrants(baseRequest, [withDelegator])).toBeNull()
  })

  it('excludes grants with different delegate', () => {
    const withDelegate = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: { ...existingGrant.request, delegate: 'agent@example.com' },
    })
    expect(findSimilarCliGrants(baseRequest, [withDelegate])).toBeNull()
  })

  it('excludes grants with different adapter_digest', () => {
    const withAdapterDigest = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: {
        ...existingGrant.request,
        execution_context: {
          argv: ['gh'],
          argv_hash: 'SHA-256:abc',
          adapter_id: 'gh',
          adapter_version: '1',
          adapter_digest: 'SHA-256:different',
          resolved_executable: 'gh',
        },
      },
    })
    expect(findSimilarCliGrants(baseRequest, [withAdapterDigest])).toBeNull()
  })

  it('excludes grants with no CLI authorization details', () => {
    const noCliDetails = makeGrant({
      ...existingGrant,
      id: crypto.randomUUID(),
      request: {
        ...existingGrant.request,
        authorization_details: [],
      },
    })
    expect(findSimilarCliGrants(baseRequest, [noCliDetails])).toBeNull()
  })

  it('handles multiple similar grants', () => {
    const grant2 = makeGrant({
      id: crypto.randomUUID(),
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'always',
        authorization_details: [makeCliDetail({
          resource_chain: [
            { resource: 'owner', selector: { login: 'openape' } },
            { resource: 'repo', selector: { name: 'api' } },
          ],
          permission: 'gh.owner[login=openape].repo[name=api]#list',
        })],
      },
    })

    const result = findSimilarCliGrants(baseRequest, [existingGrant, grant2])
    expect(result).not.toBeNull()
    expect(result!.similar_grants).toHaveLength(2)
  })
})
