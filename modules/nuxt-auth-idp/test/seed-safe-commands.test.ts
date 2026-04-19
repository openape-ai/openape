import type { OpenApeGrant, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { SAFE_COMMAND_DEFAULTS } from '@openape/grants'
import { beforeEach, describe, expect, it } from 'vitest'
import { seedDefaultSafeCommands } from '../src/runtime/server/utils/seed-safe-commands'
import type { ExtendedGrantStore } from '../src/runtime/server/utils/grant-store'

function makeInMemoryStore(): ExtendedGrantStore {
  const grants = new Map<string, OpenApeGrant>()

  const base: GrantStore = {
    async save(g) {
      grants.set(g.id, g)
    },
    async findById(id) {
      return grants.get(id) ?? null
    },
    async updateStatus(id, status, extra) {
      const g = grants.get(id)
      if (!g) throw new Error('not found')
      grants.set(id, { ...g, status, ...extra })
    },
    async findPending() {
      return [...grants.values()].filter(g => g.status === 'pending')
    },
    async findByRequester(requester) {
      return [...grants.values()].filter(g => g.request.requester === requester)
    },
    async listGrants(_params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
      return { items: [...grants.values()], nextCursor: null }
    },
  }

  return {
    ...base,
    async findAll() {
      return [...grants.values()]
    },
    async findByDelegate(delegate) {
      return [...grants.values()].filter(g => g.type === 'delegation' && g.request.delegate === delegate)
    },
    async findByDelegator(delegator) {
      return [...grants.values()].filter(g => g.type === 'delegation' && g.request.delegator === delegator)
    },
  }
}

describe('seedDefaultSafeCommands', () => {
  let store: ExtendedGrantStore

  beforeEach(() => {
    store = makeInMemoryStore()
  })

  it('creates one standing grant per default on first run', async () => {
    const result = await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    expect(result.created).toBe(SAFE_COMMAND_DEFAULTS.length)
    expect(result.skipped).toBe(0)
    const all = await store.findByRequester('agent@x')
    expect(all).toHaveLength(SAFE_COMMAND_DEFAULTS.length)
    for (const g of all) {
      expect(g.type).toBe('standing')
      expect(g.status).toBe('approved')
      const req = g.request as { reason?: unknown, cli_id?: unknown }
      expect(req.reason).toBe('safe-command:default')
      expect(typeof req.cli_id).toBe('string')
    }
  })

  it('is idempotent: second run creates zero more', async () => {
    await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    const second = await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(SAFE_COMMAND_DEFAULTS.length)
  })

  it('only counts existing entries with default reason when computing skips', async () => {
    // Seed one grant with a DIFFERENT reason for the same cli_id to prove the
    // skip logic keys on `reason === 'safe-command:default'`, not just cli_id.
    await store.save({
      id: 'unrelated-sg',
      status: 'approved',
      type: 'standing',
      request: {
        type: 'standing',
        owner: 'owner@x',
        delegate: 'agent@x',
        requester: 'agent@x',
        audience: 'shapes',
        target_host: '*',
        cli_id: 'ls',
        resource_chain_template: [],
        grant_type: 'always',
        reason: 'user-custom-scope',
      } as unknown as OpenApeGrant['request'],
      created_at: 0,
      decided_at: 0,
    })
    const result = await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    expect(result.created).toBe(SAFE_COMMAND_DEFAULTS.length)
    expect(result.skipped).toBe(0)
  })

  it('skips a default that already exists and seeds the rest', async () => {
    await store.save({
      id: 'seed-ls',
      status: 'approved',
      type: 'standing',
      request: {
        type: 'standing',
        owner: 'owner@x',
        delegate: 'agent@x',
        requester: 'agent@x',
        audience: 'shapes',
        target_host: '*',
        cli_id: 'ls',
        resource_chain_template: [],
        grant_type: 'always',
        reason: 'safe-command:default',
      } as unknown as OpenApeGrant['request'],
      created_at: 0,
      decided_at: 0,
    })
    const result = await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    expect(result.created).toBe(SAFE_COMMAND_DEFAULTS.length - 1)
    expect(result.skipped).toBe(1)
  })

  it('ignores revoked defaults when computing skips (treats as absent)', async () => {
    await store.save({
      id: 'revoked-ls',
      status: 'revoked',
      type: 'standing',
      request: {
        type: 'standing',
        owner: 'owner@x',
        delegate: 'agent@x',
        requester: 'agent@x',
        audience: 'shapes',
        target_host: '*',
        cli_id: 'ls',
        resource_chain_template: [],
        grant_type: 'always',
        reason: 'safe-command:default',
      } as unknown as OpenApeGrant['request'],
      created_at: 0,
      decided_at: 0,
    })
    const result = await seedDefaultSafeCommands('agent@x', 'owner@x', store)
    expect(result.created).toBe(SAFE_COMMAND_DEFAULTS.length)
    expect(result.skipped).toBe(0)
  })
})
