import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, loginWithKey, post } from '../helpers.js'

export function grantsTests(config: ResolvedConfig) {
  describe('Grants Lifecycle', () => {
    const ownerEmail = `grants-owner-${Date.now()}@example.com`
    const agentEmail = `grants-agent-${Date.now()}@example.com`
    const ownerKey = generateEd25519Key()
    const agentKey = generateEd25519Key()

    it('setup: create owner user', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: ownerEmail,
          name: 'Grants Owner',
          publicKey: ownerKey.publicKeySsh,
          owner: ownerEmail,
          type: 'human',
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('setup: create agent user', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: agentEmail,
          name: 'Grants Agent',
          publicKey: agentKey.publicKeySsh,
          owner: ownerEmail,
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('creates a grant request', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status, data } = await post(
        config.baseUrl,
        '/api/grants',
        {
          target_host: 'sp.example.com',
          audience: 'sp.example.com',
          grant_type: 'once',
          permissions: ['read'],
        },
        token,
      )
      expect(status).toBe(201)
      expect(data.id).toBeDefined()
      expect(data.status).toBe('pending')
      expect(data.request.requester).toBe(ownerEmail)
    })

    it('creates a grant with default grant_type', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status, data } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )
      expect(status).toBe(201)
      expect(data.request.grant_type).toBe('once')
    })

    it('rejects grant with missing fields', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/grants',
        { requester: 'x' },
        token,
      )
      expect(status).toBe(400)
    })

    it('rejects invalid grant_type', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com', grant_type: 'invalid' },
        token,
      )
      expect(status).toBe(400)
    })

    it('lists grants (paginated)', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status, data } = await get(config.baseUrl, '/api/grants', token)
      expect(status).toBe(200)
      expect(data.data).toBeDefined()
      expect(data.pagination).toBeDefined()
      expect(Array.isArray(data.data)).toBe(true)
    })

    it('lists grants with status filter', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status, data } = await get(config.baseUrl, '/api/grants?status=pending', token)
      expect(status).toBe(200)
      for (const g of data.data) {
        expect(g.status).toBe('pending')
      }
    })

    it('lists grants with cursor pagination', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status, data } = await get(config.baseUrl, '/api/grants?limit=1', token)
      expect(status).toBe(200)
      expect(data.data.length).toBeLessThanOrEqual(1)
      if (data.pagination.cursor) {
        const { status: s2, data: d2 } = await get(
          config.baseUrl,
          `/api/grants?limit=1&cursor=${data.pagination.cursor}`,
          token,
        )
        expect(s2).toBe(200)
        expect(d2.data).toBeDefined()
      }
    })

    it('rejects listing without bearer', async () => {
      const { status } = await get(config.baseUrl, '/api/grants')
      expect(status).toBe(401)
    })

    it('approves a grant', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)

      // Create a grant to approve
      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )

      const { status, data } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/approve`,
        {},
        token,
      )
      expect(status).toBe(200)
      expect(data.grant.status).toBe('approved')
      expect(data.authz_jwt).toBeDefined()
    })

    it('approves a grant with management token', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )

      const { status } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/approve`,
        {},
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('gets grant token (AuthZ-JWT)', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)

      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )
      await post(config.baseUrl, `/api/grants/${grant.id}/approve`, {}, token)

      const { status, data } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/token`,
        {},
        token,
      )
      expect(status).toBe(200)
      expect(data.authz_jwt).toBeDefined()
      expect(data.grant.id).toBe(grant.id)
    })

    it('denies a grant', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )

      const { status, data } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/deny`,
        {},
        token,
      )
      expect(status).toBe(200)
      expect(data.status).toBe('denied')
    })

    it('revokes an approved grant', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )
      await post(config.baseUrl, `/api/grants/${grant.id}/approve`, {}, token)

      const { status, data } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/revoke`,
        {},
        token,
      )
      expect(status).toBe(200)
      expect(data.status).toBe('revoked')
    })

    it('rejects approve for non-existent grant', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/grants/nonexistent-id/approve',
        {},
        token,
      )
      expect(status).toBe(404)
    })

    it('rejects approve for already decided grant', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { data: grant } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        token,
      )
      await post(config.baseUrl, `/api/grants/${grant.id}/approve`, {}, token)

      const { status } = await post(
        config.baseUrl,
        `/api/grants/${grant.id}/approve`,
        {},
        token,
      )
      expect(status).toBe(400)
    })

    it('batch operations', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)

      const { data: g1 } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'batch1.example.com', audience: 'batch1.example.com' },
        token,
      )
      const { data: g2 } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'batch2.example.com', audience: 'batch2.example.com' },
        token,
      )

      const { status, data } = await post(
        config.baseUrl,
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'approve' }, { id: g2.id, action: 'deny' }] },
        token,
      )
      expect(status).toBe(200)
      expect(data.results[0].success).toBe(true)
      expect(data.results[0].status).toBe('approved')
      expect(data.results[1].success).toBe(true)
      expect(data.results[1].status).toBe('denied')
    })

    it('batch returns 207 on partial error', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { data: g1 } = await post(
        config.baseUrl,
        '/api/grants',
        { target_host: 'batch3.example.com', audience: 'batch3.example.com' },
        token,
      )

      const { status } = await post(
        config.baseUrl,
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'approve' }, { id: 'nonexistent', action: 'approve' }] },
        token,
      )
      expect(status).toBe(207)
    })

    it('batch rejects empty operations', async () => {
      const token = await loginWithKey(config.baseUrl, ownerEmail, ownerKey.privateKey)
      const { status } = await post(
        config.baseUrl,
        '/api/grants/batch',
        { operations: [] },
        token,
      )
      expect(status).toBe(400)
    })

    it('cleanup: delete test users', async () => {
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(agentEmail)}`, config.managementToken)
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(ownerEmail)}`, config.managementToken)
    })
  })
}
