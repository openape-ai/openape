import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, post } from '../helpers.js'

export function adminUsersTests(config: ResolvedConfig) {
  describe('Admin Users', () => {
    const testEmail = `admin-suite-${Date.now()}@example.com`

    it('creates a user via admin API', async () => {
      const { status, data } = await post(
        config.baseUrl,
        '/api/admin/users',
        { email: testEmail, name: 'Admin Suite User' },
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.email).toBe(testEmail)
    })

    it('lists users (paginated)', async () => {
      const { status, data } = await get(
        config.baseUrl,
        '/api/admin/users',
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.data).toBeDefined()
      expect(data.pagination).toBeDefined()
      expect(Array.isArray(data.data)).toBe(true)
    })

    it('searches users', async () => {
      const { status, data } = await get(
        config.baseUrl,
        `/api/admin/users?search=${encodeURIComponent(testEmail)}`,
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.data).toBeDefined()
    })

    it('deletes a user', async () => {
      const { status, data } = await del(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(testEmail)}`,
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
    })

    it('delete returns 404 for non-existent user', async () => {
      const { status } = await del(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent('nonexistent-user-suite@example.com')}`,
        config.managementToken,
      )
      expect(status).toBe(404)
    })

    it('rejects listing without management token (401)', async () => {
      const { status } = await get(config.baseUrl, '/api/admin/users')
      expect(status).toBe(401)
    })

    it('rejects with wrong management token (403)', async () => {
      const { status } = await get(config.baseUrl, '/api/admin/users', 'wrong-token')
      expect(status).toBe(403)
    })

    it('enrolls a new agent user', async () => {
      const key = generateEd25519Key()
      const agentEmail = `agent-suite-${Date.now()}@example.com`
      const ownerEmail = `owner-suite-${Date.now()}@example.com`

      // Create owner first
      await post(
        config.baseUrl,
        '/api/admin/users',
        { email: ownerEmail, name: 'Owner Suite' },
        config.managementToken,
      )

      const { status, data } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: agentEmail,
          name: 'Agent Suite',
          publicKey: key.publicKeySsh,
          owner: ownerEmail,
        },
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.email).toBe(agentEmail)
      expect(data.owner).toBe(ownerEmail)
      expect(data.status).toBe('active')

      // Cleanup
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(agentEmail)}`, config.managementToken)
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(ownerEmail)}`, config.managementToken)
    })
  })
}
