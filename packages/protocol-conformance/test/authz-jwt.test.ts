import type { OpenApeGrant } from '@openape/core'
import { generateKeyPair } from '@openape/core'
import { issueAuthzJWT } from '@openape/grants'
import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { getValidator } from './harness.js'

function makeApprovedGrant(overrides?: Partial<OpenApeGrant>): OpenApeGrant {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: crypto.randomUUID(),
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini.local',
      audience: 'apes',
      grant_type: 'once',
      permissions: ['read', 'write'],
    },
    status: 'approved',
    decided_by: 'admin@example.com',
    created_at: now - 60,
    decided_at: now,
    ...overrides,
  }
}

describe('authz-jwt claims — authz-jwt-claims.json', () => {
  const { validate } = getValidator('authz-jwt-claims.json')

  it('basic once-grant claims satisfy the schema (required fields only)', async () => {
    const { privateKey } = await generateKeyPair()
    const grant = makeApprovedGrant()
    const token = await issueAuthzJWT(grant, 'https://id.example.com', privateKey)
    const claims = decodeJwt(token)
    const { valid, errors } = validate(claims)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })

  it('delegation grant claims (with scope array) satisfy schema', async () => {
    // authz-jwt-claims.json now has a `scope` property — resolved drift.
    const { privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const grant = makeApprovedGrant({
      type: 'delegation',
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini.local',
        audience: 'tasks.openape.ai',
        grant_type: 'always',
        delegator: 'patrick@example.com',
        delegate: 'agent@example.com',
        scopes: ['timetrack:read', 'timetrack:write'],
      },
      expires_at: now + 3600,
    })
    const token = await issueAuthzJWT(grant, 'https://id.example.com', privateKey)
    const claims = decodeJwt(token)
    const { valid, errors } = validate(claims)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })

  it('delegation grant claims with `delegate` field satisfy schema', async () => {
    // authz-jwt-claims.json now has a `delegate` property — resolved drift.
    const { privateKey } = await generateKeyPair()
    const now = Math.floor(Date.now() / 1000)
    const grant = makeApprovedGrant({
      type: 'delegation',
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini.local',
        audience: 'tasks.openape.ai',
        grant_type: 'always',
        delegator: 'patrick@example.com',
        delegate: 'agent@example.com',
      },
      expires_at: now + 3600,
    })
    const token = await issueAuthzJWT(grant, 'https://id.example.com', privateKey)
    const claims = decodeJwt(token)
    const { valid, errors } = validate(claims)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })
})
