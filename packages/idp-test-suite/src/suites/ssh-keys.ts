import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, post } from '../helpers.js'

export function sshKeyTests(config: ResolvedConfig) {
  describe('SSH Key Management', () => {
    const userEmail = `sshkey-suite-${Date.now()}@example.com`
    const key1 = generateEd25519Key()
    let keyId: string

    it('creates user for SSH key tests', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/admin/users',
        { email: userEmail, name: 'SSH Key User' },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('adds an SSH key for a user', async () => {
      const { status, data } = await post(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        { publicKey: key1.publicKeySsh, name: 'Test Key 1' },
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.keyId).toBeDefined()
      expect(data.userEmail).toBe(userEmail)
      expect(data.name).toBe('Test Key 1')
      keyId = data.keyId
    })

    it('lists SSH keys for a user', async () => {
      const { status, data } = await get(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThanOrEqual(1)
      expect(data.some((k: { userEmail: string }) => k.userEmail === userEmail)).toBe(true)
    })

    it('rejects duplicate SSH key', async () => {
      const { status } = await post(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        { publicKey: key1.publicKeySsh },
        config.managementToken,
      )
      expect(status).toBe(409)
    })

    it('rejects invalid SSH key format', async () => {
      const { status } = await post(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        { publicKey: 'not-a-valid-key' },
        config.managementToken,
      )
      expect(status).toBe(400)
    })

    it('rejects missing publicKey', async () => {
      const { status } = await post(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        {},
        config.managementToken,
      )
      expect(status).toBe(400)
    })

    it('deletes an SSH key', async () => {
      const { status, data } = await del(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys/${keyId}`,
        config.managementToken,
      )
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
    })

    it('returns 404 for non-existent key deletion', async () => {
      const { status } = await del(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys/nonexistent-key`,
        config.managementToken,
      )
      expect(status).toBe(404)
    })

    it('rejects SSH key operations without management token', async () => {
      const { status } = await post(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}/ssh-keys`,
        { publicKey: 'ssh-ed25519 AAAA' },
      )
      expect(status).toBe(401)
    })

    it('cleanup: delete test user', async () => {
      const { status } = await del(
        config.baseUrl,
        `/api/admin/users/${encodeURIComponent(userEmail)}`,
        config.managementToken,
      )
      expect(status).toBe(200)
    })
  })
}
