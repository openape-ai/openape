import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, loginWithKey, post, signChallenge } from '../helpers.js'

export function authTests(config: ResolvedConfig) {
  describe('Challenge-Response Auth', () => {
    const humanEmail = `auth-human-${Date.now()}@example.com`
    const agentEmail = `auth-agent-${Date.now()}@example.com`
    const humanKey = generateEd25519Key()
    const agentKey = generateEd25519Key()

    it('setup: create human user with SSH key', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: humanEmail,
          name: 'Auth Human',
          publicKey: humanKey.publicKeySsh,
          owner: humanEmail,
          type: 'human',
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('setup: create agent user with SSH key', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: agentEmail,
          name: 'Auth Agent',
          publicKey: agentKey.publicKeySsh,
          owner: humanEmail,
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('issues a challenge for existing user', async () => {
      const { status, data } = await post(config.baseUrl, '/api/auth/challenge', { id: humanEmail })
      expect(status).toBe(200)
      expect(data.challenge).toBeDefined()
      expect(typeof data.challenge).toBe('string')
    })

    it('returns 404 for unknown user challenge', async () => {
      const { status } = await post(config.baseUrl, '/api/auth/challenge', { id: 'unknown-user-suite@example.com' })
      expect(status).toBe(404)
    })

    it('rejects challenge with missing id', async () => {
      const { status } = await post(config.baseUrl, '/api/auth/challenge', {})
      expect(status).toBe(400)
    })

    it('authenticates with valid signature and returns JWT', async () => {
      const { data: challengeData } = await post(config.baseUrl, '/api/auth/challenge', { id: humanEmail })
      const signature = signChallenge(challengeData.challenge, humanKey.privateKey)
      const { status, data } = await post(config.baseUrl, '/api/auth/authenticate', {
        id: humanEmail,
        challenge: challengeData.challenge,
        signature,
      })
      expect(status).toBe(200)
      expect(data.token).toBeDefined()
      expect(data.act).toBe('human')
      expect(data.email).toBe(humanEmail)
      expect(data.expires_in).toBeDefined()
    })

    it('agent authenticates with act=agent', async () => {
      const { data: challengeData } = await post(config.baseUrl, '/api/auth/challenge', { id: agentEmail })
      const signature = signChallenge(challengeData.challenge, agentKey.privateKey)
      const { status, data } = await post(config.baseUrl, '/api/auth/authenticate', {
        id: agentEmail,
        challenge: challengeData.challenge,
        signature,
      })
      expect(status).toBe(200)
      expect(data.token).toBeDefined()
      expect(data.act).toBe('agent')
    })

    it('rejects authentication with invalid signature', async () => {
      const { data: challengeData } = await post(config.baseUrl, '/api/auth/challenge', { id: humanEmail })
      // Sign with wrong key
      const wrongSig = signChallenge(challengeData.challenge, agentKey.privateKey)
      const { status } = await post(config.baseUrl, '/api/auth/authenticate', {
        id: humanEmail,
        challenge: challengeData.challenge,
        signature: wrongSig,
      })
      expect(status).toBe(401)
    })

    it('rejects authentication with invalid challenge', async () => {
      const { status } = await post(config.baseUrl, '/api/auth/authenticate', {
        id: humanEmail,
        challenge: 'invalid-challenge-value',
        signature: Buffer.from('fakesig').toString('base64'),
      })
      expect(status).toBe(401)
    })

    it('rejects authenticate with missing fields', async () => {
      const { status } = await post(config.baseUrl, '/api/auth/authenticate', { id: humanEmail })
      expect(status).toBe(400)
    })

    it('loginWithKey helper returns valid token', async () => {
      const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
    })

    it('cleanup: delete test users', async () => {
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(agentEmail)}`, config.managementToken)
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(humanEmail)}`, config.managementToken)
    })
  })
}
