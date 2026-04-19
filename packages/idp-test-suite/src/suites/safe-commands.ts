import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, loginWithKey, post } from '../helpers.js'

/**
 * E2E suite for the Phase 4 safe-commands feature:
 *
 * 1. Enrolling an agent auto-seeds the default safe-command SGs
 * 2. Enrolling a human does NOT seed safe-commands
 * 3. Bulk-seed API creates/skips SGs correctly; validates input
 * 4. Safe-command SG causes low-risk read grants to auto-approve
 * 5. After revoking the SG, same request falls through to pending
 */
export function safeCommandsTests(config: ResolvedConfig) {
  describe('Safe Commands (Phase 4)', () => {
    describe('Seeding on enrollment', () => {
      const humanEmail = `sc-human-${Date.now()}@example.com`
      const agentEmail = `sc-agent-${Date.now()}@example.com`
      const humanKey = generateEd25519Key()
      const agentKey = generateEd25519Key()

      it('setup: enroll a human — no safe-command SGs created', async () => {
        const { status, data } = await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: humanEmail, name: 'SC Human', publicKey: humanKey.publicKeySsh, owner: humanEmail, type: 'human' },
          config.managementToken,
        )
        expect(status).toBe(200)
        expect(data.seeded_safe_commands ?? 0).toBe(0)
      })

      it('enrolling an agent seeds 14 default safe-command SGs', async () => {
        const { status, data } = await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: agentEmail, name: 'SC Agent', publicKey: agentKey.publicKeySsh, owner: humanEmail },
          config.managementToken,
        )
        expect(status).toBe(200)
        expect(data.seeded_safe_commands).toBe(14)
      })

      it('the seeded SGs show up in the owner standing-grants listing', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await get(config.baseUrl, '/api/standing-grants', token)
        expect(status).toBe(200)
        const mine = data.filter(
          (g: { request: { reason?: string, delegate?: string } }) =>
            g.request.reason === 'safe-command:default' && g.request.delegate === agentEmail,
        )
        expect(mine).toHaveLength(14)
      })
    })

    describe('Auto-approval via safe-command SG', () => {
      const humanEmail = `sc2-human-${Date.now()}@example.com`
      const agentEmail = `sc2-agent-${Date.now()}@example.com`
      const humanKey = generateEd25519Key()
      const agentKey = generateEd25519Key()
      let lsGrantId: string | undefined

      it('setup: enroll owner + agent (agent gets safe-commands automatically)', async () => {
        await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: humanEmail, name: 'SC2 H', publicKey: humanKey.publicKeySsh, owner: humanEmail, type: 'human' },
          config.managementToken,
        )
        await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: agentEmail, name: 'SC2 A', publicKey: agentKey.publicKeySsh, owner: humanEmail },
          config.managementToken,
        )
      })

      it('low-risk `ls` read grant auto-approves via the seeded safe-command SG', async () => {
        const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/grants',
          {
            requester: agentEmail,
            target_host: 'hostA',
            audience: 'shapes',
            grant_type: 'once',
            command: ['ls', '-la'],
            authorization_details: [{
              type: 'openape_cli',
              cli_id: 'ls',
              operation_id: 'ls.list',
              action: 'read',
              risk: 'low',
              resource_chain: [{ resource: 'fs', selector: { path: '.' } }],
              permission: 'ls.fs[path=.]#read',
              display: 'ls -la',
            }],
          },
          agentToken,
        )
        expect(status).toBe(201)
        expect(data.status).toBe('approved')
        expect(data.decided_by_standing_grant).toBeDefined()
        expect(data.approved_automatically).toBe(true)
        lsGrantId = data.decided_by_standing_grant
      })

      it('revoking the `ls` safe-command SG causes the next request to go pending', async () => {
        expect(lsGrantId).toBeDefined()
        const ownerToken = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status } = await del(config.baseUrl, `/api/standing-grants/${lsGrantId}`, ownerToken)
        expect(status).toBe(200)

        const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
        const { data } = await post(
          config.baseUrl,
          '/api/grants',
          {
            requester: agentEmail,
            target_host: 'hostA',
            audience: 'shapes',
            grant_type: 'once',
            command: ['ls', '/etc'],
            authorization_details: [{
              type: 'openape_cli',
              cli_id: 'ls',
              operation_id: 'ls.list',
              action: 'read',
              risk: 'low',
              resource_chain: [{ resource: 'fs', selector: { path: '/etc' } }],
              permission: 'ls.fs[path=/etc]#read',
              display: 'ls /etc',
            }],
          },
          agentToken,
        )
        expect(data.status).toBe('pending')
      })
    })

    describe('Bulk-seed endpoint', () => {
      const humanEmail = `scb-human-${Date.now()}@example.com`
      const agentA = `scb-a-${Date.now()}@example.com`
      const agentB = `scb-b-${Date.now()}@example.com`
      const humanKey = generateEd25519Key()
      const keyA = generateEd25519Key()
      const keyB = generateEd25519Key()

      it('setup: human + two fresh agents', async () => {
        await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: humanEmail, name: 'SCB H', publicKey: humanKey.publicKeySsh, owner: humanEmail, type: 'human' },
          config.managementToken,
        )
        await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: agentA, name: 'SCB A', publicKey: keyA.publicKeySsh, owner: humanEmail },
          config.managementToken,
        )
        await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: agentB, name: 'SCB B', publicKey: keyB.publicKeySsh, owner: humanEmail },
          config.managementToken,
        )
      })

      it('rejects missing/empty delegates', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const r1 = await post(config.baseUrl, '/api/standing-grants/bulk-seed', {}, token)
        expect(r1.status).toBe(400)
        const r2 = await post(config.baseUrl, '/api/standing-grants/bulk-seed', { delegates: [] }, token)
        expect(r2.status).toBe(400)
      })

      it('rejects >50 delegates', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const many = Array.from({ length: 51 }, (_, i) => `scb-many-${i}@example.com`)
        const { status } = await post(
          config.baseUrl,
          '/api/standing-grants/bulk-seed',
          { delegates: many },
          token,
        )
        expect(status).toBe(400)
      })

      it('is idempotent: seeding agents that already have defaults returns skipped counts', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/standing-grants/bulk-seed',
          { delegates: [agentA, agentB] },
          token,
        )
        expect(status).toBe(200)
        expect(Array.isArray(data.results)).toBe(true)
        const rA = data.results.find((r: { delegate: string }) => r.delegate === agentA)
        const rB = data.results.find((r: { delegate: string }) => r.delegate === agentB)
        expect(rA).toMatchObject({ created: 0, skipped: 14 })
        expect(rB).toMatchObject({ created: 0, skipped: 14 })
      })

      it('silently reports 0/0 for unowned delegates (no enumeration leak)', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/standing-grants/bulk-seed',
          { delegates: ['unknown-someone-else@example.com'] },
          token,
        )
        expect(status).toBe(200)
        expect(data.results).toEqual([
          { delegate: 'unknown-someone-else@example.com', created: 0, skipped: 0 },
        ])
      })

      it('requires authentication (no bearer ⇒ 401)', async () => {
        const { status } = await post(
          config.baseUrl,
          '/api/standing-grants/bulk-seed',
          { delegates: [agentA] },
        )
        expect(status).toBe(401)
      })
    })
  })
}
