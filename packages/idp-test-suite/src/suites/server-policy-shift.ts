import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { del, generateEd25519Key, get, loginWithKey, post } from '../helpers.js'

/**
 * E2E suite for the Phase 1 server-side policy foundation:
 *
 * 1. Shape registry GET/resolve endpoints
 * 2. Standing-grants POST/GET/DELETE lifecycle
 * 3. Auto-approval on /api/grants when a standing grant covers incoming
 * 4. Non-matching requests still go to pending
 * 5. Agent-view aggregate
 *
 * Assumes the shape registry has NOT been seeded (so the generic fallback
 * is exercised for resolve). Admin-panel-style tests for seeded shapes
 * belong to the consumer app's integration tests, not this portable suite.
 */
export function serverPolicyShiftTests(config: ResolvedConfig) {
  describe('Server-side policy shift (Phase 1)', () => {
    describe('Shape registry API', () => {
      it('GET /api/shapes returns an array', async () => {
        const { status, data } = await get(config.baseUrl, '/api/shapes')
        expect(status).toBe(200)
        expect(Array.isArray(data)).toBe(true)
      })

      it('GET /api/shapes/:cliId returns 404 for unknown CLI', async () => {
        const { status } = await get(config.baseUrl, '/api/shapes/totally-not-a-shape-xyz')
        expect(status).toBe(404)
      })

      it('POST /api/shapes/resolve returns generic fallback for unknown CLI', async () => {
        const { status, data } = await post(
          config.baseUrl,
          '/api/shapes/resolve',
          { cli_id: 'kubectl-fake', argv: ['kubectl-fake', 'get', 'pods'] },
        )
        expect(status).toBe(200)
        expect(data.operation_id).toBe('_generic.exec')
        expect(data.synthetic).toBe(true)
        expect(data.detail.risk).toBe('high')
        expect(data.detail.constraints?.exact_command).toBe(true)
      })

      it('POST /api/shapes/resolve rejects missing cli_id', async () => {
        const { status } = await post(
          config.baseUrl,
          '/api/shapes/resolve',
          { argv: ['x', 'y'] },
        )
        expect(status).toBe(400)
      })

      it('POST /api/shapes/resolve rejects empty argv', async () => {
        const { status } = await post(
          config.baseUrl,
          '/api/shapes/resolve',
          { cli_id: 'anything', argv: [] },
        )
        expect(status).toBe(400)
      })
    })

    describe('Standing grants lifecycle + auto-approval', () => {
      const humanEmail = `sgshift-human-${Date.now()}@example.com`
      const agentEmail = `sgshift-agent-${Date.now()}@example.com`
      const humanKey = generateEd25519Key()
      const agentKey = generateEd25519Key()
      let standingGrantId: string

      it('setup: create human + agent', async () => {
        const { status: s1 } = await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: humanEmail, name: 'SG Human', publicKey: humanKey.publicKeySsh, owner: humanEmail, type: 'human' },
          config.managementToken,
        )
        expect(s1).toBe(200)
        const { status: s2 } = await post(
          config.baseUrl,
          '/api/auth/enroll',
          { email: agentEmail, name: 'SG Agent', publicKey: agentKey.publicKeySsh, owner: humanEmail },
          config.managementToken,
        )
        expect(s2).toBe(200)
      })

      it('human creates a standing grant for the agent', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/standing-grants',
          {
            delegate: agentEmail,
            audience: 'shapes',
            grant_type: 'always',
            resource_chain_template: [{ resource: 'cli', selector: { name: 'echo' } }],
            max_risk: 'high',
            reason: 'e2e: test pre-authorization for echo',
          },
          token,
        )
        expect(status).toBe(201)
        expect(data.type).toBe('standing')
        expect(data.status).toBe('approved')
        expect(data.decided_by).toBe(humanEmail)
        expect(data.request.delegate).toBe(agentEmail)
        standingGrantId = data.id
      })

      it('listing standing grants as the owner returns it', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await get(config.baseUrl, '/api/standing-grants', token)
        expect(status).toBe(200)
        expect(Array.isArray(data)).toBe(true)
        expect(data.find((g: { id: string }) => g.id === standingGrantId)).toBeDefined()
      })

      it('agent grant request matching the SG auto-approves', async () => {
        const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/grants',
          {
            requester: agentEmail,
            target_host: 'hostA',
            audience: 'shapes',
            grant_type: 'once',
            command: ['echo', 'hello'],
            authorization_details: [{
              type: 'openape_cli',
              cli_id: 'echo',
              operation_id: 'echo.say',
              action: 'exec',
              risk: 'low',
              resource_chain: [{ resource: 'cli', selector: { name: 'echo' } }],
              permission: 'echo.cli[name=echo]#exec',
              display: 'echo hello',
            }],
          },
          agentToken,
        )
        expect(status).toBe(201)
        expect(data.status).toBe('approved')
        expect(data.decided_by_standing_grant).toBe(standingGrantId)
        expect(data.approved_automatically).toBe(true)
      })

      it('agent grant request NOT covered by SG falls through to pending', async () => {
        const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
        const { status, data } = await post(
          config.baseUrl,
          '/api/grants',
          {
            requester: agentEmail,
            target_host: 'hostA',
            audience: 'shapes',
            grant_type: 'once',
            command: ['rm', '/tmp/x'],
            authorization_details: [{
              type: 'openape_cli',
              cli_id: 'rm',
              operation_id: 'rm.delete',
              action: 'exec',
              risk: 'medium',
              resource_chain: [{ resource: 'filesystem', selector: { path: '/tmp/x' } }],
              permission: 'rm.filesystem[path=/tmp/x]#exec',
              display: 'Delete /tmp/x',
            }],
          },
          agentToken,
        )
        expect(status).toBe(201)
        expect(data.status).toBe('pending')
        expect(data.decided_by_standing_grant).toBeUndefined()
      })

      it('revoking the standing grant stops auto-approval', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status } = await del(config.baseUrl, `/api/standing-grants/${standingGrantId}`, token)
        expect(status).toBe(200)

        // Next request for echo should now land in pending
        const agentToken = await loginWithKey(config.baseUrl, agentEmail, agentKey.privateKey)
        const { data } = await post(
          config.baseUrl,
          '/api/grants',
          {
            requester: agentEmail,
            target_host: 'hostA',
            audience: 'shapes',
            grant_type: 'once',
            command: ['echo', 'world'],
            authorization_details: [{
              type: 'openape_cli',
              cli_id: 'echo',
              operation_id: 'echo.say',
              action: 'exec',
              risk: 'low',
              resource_chain: [{ resource: 'cli', selector: { name: 'echo' } }],
              permission: 'echo.cli[name=echo]#exec',
              display: 'echo world',
            }],
          },
          agentToken,
        )
        expect(data.status).toBe('pending')
      })
    })

    describe('Agent-view endpoint', () => {
      const humanEmail = `av-human-${Date.now()}@example.com`
      const agentEmail = `av-agent-${Date.now()}@example.com`
      const humanKey = generateEd25519Key()
      const agentKey = generateEd25519Key()

      it('setup: create human + agent', async () => {
        await post(config.baseUrl, '/api/auth/enroll', { email: humanEmail, name: 'AV H', publicKey: humanKey.publicKeySsh, owner: humanEmail, type: 'human' }, config.managementToken)
        await post(config.baseUrl, '/api/auth/enroll', { email: agentEmail, name: 'AV A', publicKey: agentKey.publicKeySsh, owner: humanEmail }, config.managementToken)
      })

      it('returns the agents owned by the caller', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status, data } = await get(config.baseUrl, `/api/users/${encodeURIComponent(humanEmail)}/agents`, token)
        expect(status).toBe(200)
        expect(Array.isArray(data)).toBe(true)
        const agent = data.find((a: { email: string }) => a.email === agentEmail)
        expect(agent).toBeDefined()
        expect(agent.standing_grants).toEqual([])
        expect(agent.recent_grants).toEqual([])
        expect(agent.grant_counts).toMatchObject({ pending: 0, approved: 0, denied: 0, revoked: 0, expired: 0, used: 0 })
      })

      it('rejects cross-user access with 403', async () => {
        const token = await loginWithKey(config.baseUrl, humanEmail, humanKey.privateKey)
        const { status } = await get(config.baseUrl, '/api/users/someone-else@example.com/agents', token)
        expect(status).toBe(403)
      })
    })
  })
}
