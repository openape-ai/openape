import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, loginWithKey, post } from '../helpers.js'

export function delegationsTests(config: ResolvedConfig) {
  describe('Delegations Lifecycle', () => {
    const humanEmail = `deleg-human-${Date.now()}@example.com`
    const agentEmail = `deleg-agent-${Date.now()}@example.com`
    const humanKey = generateEd25519Key()
    const agentKey = generateEd25519Key()
    let delegationId: string

    it('setup: create human user (delegator)', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: humanEmail,
          name: 'Deleg Human',
          publicKey: humanKey.publicKeySsh,
          owner: humanEmail,
          type: 'human',
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('setup: create agent user (delegate)', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: agentEmail,
          name: 'Deleg Agent',
          publicKey: agentKey.publicKeySsh,
          owner: humanEmail,
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('human creates delegation', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { status, data } = await post(
        config.baseUrl,
        '/api/delegations',
        {
          delegate: agentEmail,
          audience: 'sp.example.com',
          grant_type: 'always',
          scopes: ['read', 'write'],
        },
        token,
      )
      expect(status).toBe(201)
      expect(data.type).toBe('delegation')
      expect(data.status).toBe('approved')
      expect(data.request.delegator).toBe(humanEmail)
      expect(data.request.delegate).toBe(agentEmail)
      expect(data.request.audience).toBe('sp.example.com')
      expect(data.request.scopes).toEqual(['read', 'write'])
      delegationId = data.id
    })

    it('agent cannot create delegation (403)', async () => {
      const token = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/delegations',
        {
          delegate: humanEmail,
          audience: 'sp.example.com',
        },
        token,
      )
      expect(status).toBe(403)
    })

    it('rejects delegation without bearer token', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/delegations',
        { delegate: agentEmail, audience: 'sp.example.com' },
      )
      expect(status).toBe(401)
    })

    it('rejects delegation with missing delegate', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/delegations',
        { audience: 'sp.example.com' },
        token,
      )
      expect(status).toBe(400)
    })

    it('rejects delegation with missing audience', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/delegations',
        { delegate: agentEmail },
        token,
      )
      expect(status).toBe(400)
    })

    it('lists delegations as delegator', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { status, data } = await get(
        config.baseUrl,
        '/api/delegations?role=delegator',
        token,
      )
      expect(status).toBe(200)
      expect(data.data).toBeDefined()
      expect(data.pagination).toBeDefined()
      expect(Array.isArray(data.data)).toBe(true)
      expect(data.data.length).toBeGreaterThan(0)
      expect(data.data.every((g: { request: { delegator: string } }) => g.request.delegator === humanEmail)).toBe(true)
    })

    it('lists delegations as delegate', async () => {
      const token = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
      const { status, data } = await get(
        config.baseUrl,
        '/api/delegations?role=delegate',
        token,
      )
      expect(status).toBe(200)
      expect(data.data).toBeDefined()
      expect(data.data.length).toBeGreaterThan(0)
      expect(data.data.every((g: { request: { delegate: string } }) => g.request.delegate === agentEmail)).toBe(true)
    })

    it('supports delegation pagination', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { status, data } = await get(
        config.baseUrl,
        '/api/delegations?role=delegator&limit=1',
        token,
      )
      expect(status).toBe(200)
      expect(data.data).toHaveLength(1)
    })

    it('validates delegation', async () => {
      const { status, data } = await post(
        config.baseUrl,
        `/api/delegations/${delegationId}/validate`,
        { delegate: agentEmail, audience: 'sp.example.com' },
      )
      expect(status).toBe(200)
      expect(data.valid).toBe(true)
      expect(data.delegation).toBeDefined()
    })

    it('validate returns invalid for wrong delegate', async () => {
      const { status, data } = await post(
        config.baseUrl,
        `/api/delegations/${delegationId}/validate`,
        { delegate: 'wrong@example.com', audience: 'sp.example.com' },
      )
      expect(status).toBe(200)
      expect(data.valid).toBe(false)
    })

    it('validate returns invalid for wrong audience', async () => {
      const { status, data } = await post(
        config.baseUrl,
        `/api/delegations/${delegationId}/validate`,
        { delegate: agentEmail, audience: 'wrong.example.com' },
      )
      expect(status).toBe(200)
      expect(data.valid).toBe(false)
    })

    it('validate returns invalid for non-existent delegation', async () => {
      const { status, data } = await post(
        config.baseUrl,
        '/api/delegations/nonexistent-deleg-id/validate',
        { delegate: agentEmail, audience: 'sp.example.com' },
      )
      expect(status).toBe(200)
      expect(data.valid).toBe(false)
    })

    it('revokes a delegation', async () => {
      // Create a new delegation to revoke
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const { data: newDeleg } = await post(
        config.baseUrl,
        '/api/delegations',
        {
          delegate: agentEmail,
          audience: 'revoke-test.example.com',
          grant_type: 'always',
        },
        token,
      )

      const { status, data } = await del(
        config.baseUrl,
        `/api/delegations/${newDeleg.id}`,
        token,
      )
      expect(status).toBe(200)
      expect(data.status).toBe('revoked')
    })

    it('delegate cannot revoke delegation (403)', async () => {
      const humanToken = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)

      const { data: newDeleg } = await post(
        config.baseUrl,
        '/api/delegations',
        {
          delegate: agentEmail,
          audience: 'revoke-auth.example.com',
          grant_type: 'always',
        },
        humanToken,
      )

      const { status } = await del(
        config.baseUrl,
        `/api/delegations/${newDeleg.id}`,
        agentToken,
      )
      expect(status).toBe(403)
    })

    it('validate fails after revoke', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)

      // Create and revoke
      const { data: newDeleg } = await post(
        config.baseUrl,
        '/api/delegations',
        {
          delegate: agentEmail,
          audience: 'validate-revoke.example.com',
          grant_type: 'always',
        },
        token,
      )
      await del(config.baseUrl, `/api/delegations/${newDeleg.id}`, token)

      // Validate should fail
      const { data } = await post(
        config.baseUrl,
        `/api/delegations/${newDeleg.id}/validate`,
        { delegate: agentEmail, audience: 'validate-revoke.example.com' },
      )
      expect(data.valid).toBe(false)
    })

    it('cleanup: delete test users', async () => {
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(agentEmail)}`, config.managementToken)
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(humanEmail)}`, config.managementToken)
    })
  })
}
