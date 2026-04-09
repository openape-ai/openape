import type { OpenApeCliAuthorizationDetail, OpenApeGrantRequest } from '@openape/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  approveGrant,
  approveGrantWithExtension,
  approveGrantWithWidening,
  createDelegation,
  createGrant,
  denyGrant,
  introspectGrant,
  revokeGrant,
  useGrant,
  validateDelegation,
} from '../grants.js'
import { InMemoryGrantStore } from '../stores.js'

describe('grant lifecycle', () => {
  let store: InMemoryGrantStore

  const onceRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'apes',
    grant_type: 'once',
    permissions: ['read'],
    reason: 'Need to read data',
  }

  const timedRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'apes',
    grant_type: 'timed',
    permissions: ['read', 'write'],
    duration: 3600, // 1 hour
  }

  const alwaysRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target_host: 'macmini',
    audience: 'apes',
    grant_type: 'always',
    permissions: ['read'],
  }

  beforeEach(() => {
    store = new InMemoryGrantStore()
  })

  describe('createGrant', () => {
    it('creates a grant with pending status', async () => {
      const grant = await createGrant(onceRequest, store)

      expect(grant.id).toBeDefined()
      expect(grant.status).toBe('pending')
      expect(grant.request).toEqual(onceRequest)
      expect(grant.created_at).toBeGreaterThan(0)
    })

    it('persists the grant in the store', async () => {
      const grant = await createGrant(onceRequest, store)
      const found = await store.findById(grant.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(grant.id)
    })
  })

  describe('approveGrant', () => {
    it('approves a pending grant', async () => {
      const grant = await createGrant(onceRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store)

      expect(approved.status).toBe('approved')
      expect(approved.decided_by).toBe('admin@example.com')
      expect(approved.decided_at).toBeGreaterThan(0)
    })

    it('sets expires_at for timed grants', async () => {
      const grant = await createGrant(timedRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store)

      expect(approved.status).toBe('approved')
      expect(approved.expires_at).toBeDefined()
      expect(approved.expires_at).toBeGreaterThan(approved.decided_at!)
    })

    it('does not set expires_at for once grants', async () => {
      const grant = await createGrant(onceRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store)

      expect(approved.expires_at).toBeUndefined()
    })

    it('rejects approval of non-pending grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      await expect(
        approveGrant(grant.id, 'admin@example.com', store),
      ).rejects.toThrow('Grant is not pending')
    })

    it('throws for non-existent grant', async () => {
      await expect(
        approveGrant('non-existent', 'admin@example.com', store),
      ).rejects.toThrow('Grant not found')
    })

    it('overrides grant_type from once to timed', async () => {
      const grant = await createGrant(onceRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store, {
        grant_type: 'timed',
        duration: 3600,
      })

      expect(approved.request.grant_type).toBe('timed')
      expect(approved.expires_at).toBeDefined()
      expect(approved.expires_at! - approved.decided_at!).toBe(3600)
    })

    it('overrides grant_type from once to always', async () => {
      const grant = await createGrant(onceRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store, {
        grant_type: 'always',
      })

      expect(approved.request.grant_type).toBe('always')
      expect(approved.expires_at).toBeUndefined()
    })

    it('overrides grant_type from timed to always', async () => {
      const grant = await createGrant(timedRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store, {
        grant_type: 'always',
      })

      expect(approved.request.grant_type).toBe('always')
      expect(approved.expires_at).toBeUndefined()
    })

    it('overrides duration for timed grant', async () => {
      const grant = await createGrant(timedRequest, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store, {
        duration: 7200,
      })

      expect(approved.request.grant_type).toBe('timed')
      expect(approved.expires_at! - approved.decided_at!).toBe(7200)
    })

    it('rejects timed override without duration', async () => {
      const grant = await createGrant(onceRequest, store)

      await expect(
        approveGrant(grant.id, 'admin@example.com', store, { grant_type: 'timed' }),
      ).rejects.toThrow('Duration is required for timed grants')
    })

    it('defaults grant_type to once when not specified in request', async () => {
      const requestWithoutType: OpenApeGrantRequest = {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'apes',
      }
      const grant = await createGrant(requestWithoutType, store)
      const approved = await approveGrant(grant.id, 'admin@example.com', store)

      expect(approved.request.grant_type).toBe('once')
      expect(approved.expires_at).toBeUndefined()
    })
  })

  describe('denyGrant', () => {
    it('denies a pending grant', async () => {
      const grant = await createGrant(onceRequest, store)
      const denied = await denyGrant(grant.id, 'admin@example.com', store)

      expect(denied.status).toBe('denied')
      expect(denied.decided_by).toBe('admin@example.com')
      expect(denied.decided_at).toBeGreaterThan(0)
    })

    it('rejects denial of non-pending grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await denyGrant(grant.id, 'admin@example.com', store)

      await expect(
        denyGrant(grant.id, 'admin@example.com', store),
      ).rejects.toThrow('Grant is not pending')
    })

    it('throws for non-existent grant', async () => {
      await expect(
        denyGrant('non-existent', 'admin@example.com', store),
      ).rejects.toThrow('Grant not found')
    })
  })

  describe('revokeGrant', () => {
    it('revokes an approved grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)
      const revoked = await revokeGrant(grant.id, store)

      expect(revoked.status).toBe('revoked')
    })

    it('revokes a pending grant', async () => {
      const grant = await createGrant(onceRequest, store)
      const revoked = await revokeGrant(grant.id, store)

      expect(revoked.status).toBe('revoked')
    })

    it('throws for non-existent grant', async () => {
      await expect(revokeGrant('non-existent', store)).rejects.toThrow(
        'Grant not found',
      )
    })

    it('rejects revocation of denied grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await denyGrant(grant.id, 'admin@example.com', store)

      await expect(revokeGrant(grant.id, store)).rejects.toThrow(
        'Grant cannot be revoked',
      )
    })
  })

  describe('introspectGrant', () => {
    it('returns a grant by id', async () => {
      const grant = await createGrant(onceRequest, store)
      const found = await introspectGrant(grant.id, store)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(grant.id)
    })

    it('returns null for non-existent grant', async () => {
      const found = await introspectGrant('non-existent', store)
      expect(found).toBeNull()
    })

    it('auto-expires timed grants past expiration', async () => {
      const shortTimedRequest: OpenApeGrantRequest = {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'apes',
        grant_type: 'timed',
        duration: 1, // 1 second
      }

      const grant = await createGrant(shortTimedRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100))

      const introspected = await introspectGrant(grant.id, store)
      expect(introspected!.status).toBe('expired')
    })

    it('does not expire timed grants before expiration', async () => {
      const grant = await createGrant(timedRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      const introspected = await introspectGrant(grant.id, store)
      expect(introspected!.status).toBe('approved')
    })
  })

  describe('useGrant', () => {
    it('marks once-grant as used', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      const used = await useGrant(grant.id, store)
      expect(used.status).toBe('used')
      expect(used.used_at).toBeGreaterThan(0)
    })

    it('prevents re-use of once-grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)
      await useGrant(grant.id, store)

      await expect(useGrant(grant.id, store)).rejects.toThrow(
        'Grant is not approved',
      )
    })

    it('allows repeated use of always-grant', async () => {
      const grant = await createGrant(alwaysRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      const used1 = await useGrant(grant.id, store)
      expect(used1.status).toBe('approved')

      const used2 = await useGrant(grant.id, store)
      expect(used2.status).toBe('approved')
    })

    it('allows use of valid timed grant', async () => {
      const grant = await createGrant(timedRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      const used = await useGrant(grant.id, store)
      expect(used.status).toBe('approved')
    })

    it('rejects use of non-existent grant', async () => {
      await expect(useGrant('non-existent', store)).rejects.toThrow(
        'Grant not found',
      )
    })

    it('rejects use of pending grant', async () => {
      const grant = await createGrant(onceRequest, store)

      await expect(useGrant(grant.id, store)).rejects.toThrow(
        'Grant is not approved',
      )
    })
  })

  describe('delegate permission grants', () => {
    const delegateOnceRequest: OpenApeGrantRequest = {
      requester: 'agent@example.com',
      target_host: 'sp.example.com',
      audience: 'proxy',
      grant_type: 'once',
      permissions: ['delegate'],
      reason: 'Login als Owner bei sp.example.com',
    }

    const delegateTimedRequest: OpenApeGrantRequest = {
      requester: 'agent@example.com',
      target_host: 'sp.example.com',
      audience: 'proxy',
      grant_type: 'timed',
      permissions: ['delegate'],
      duration: 3600,
      reason: 'Login als Owner bei sp.example.com',
    }

    it('creates and approves delegate once-grant', async () => {
      const grant = await createGrant(delegateOnceRequest, store)
      expect(grant.request.permissions).toContain('delegate')

      const approved = await approveGrant(grant.id, 'alice@example.com', store)
      expect(approved.status).toBe('approved')

      const used = await useGrant(grant.id, store)
      expect(used.status).toBe('used')

      await expect(useGrant(grant.id, store)).rejects.toThrow('Grant is not approved')
    })

    it('creates and approves delegate timed-grant with expiry', async () => {
      const grant = await createGrant(delegateTimedRequest, store)
      const approved = await approveGrant(grant.id, 'alice@example.com', store)

      expect(approved.status).toBe('approved')
      expect(approved.expires_at).toBeDefined()

      const used = await useGrant(grant.id, store)
      expect(used.status).toBe('approved')
    })

    it('findByRequester returns delegate grants', async () => {
      await createGrant(delegateOnceRequest, store)
      await createGrant(onceRequest, store)

      const grants = await store.findByRequester('agent@example.com')
      expect(grants).toHaveLength(2)

      const delegateGrants = grants.filter(g => g.request.permissions?.includes('delegate'))
      expect(delegateGrants).toHaveLength(1)
    })
  })

  describe('inMemoryGrantStore', () => {
    it('finds pending grants', async () => {
      await createGrant(onceRequest, store)
      await createGrant(timedRequest, store)

      const pending = await store.findPending()
      expect(pending).toHaveLength(2)
    })

    it('finds grants by requester', async () => {
      await createGrant(onceRequest, store)

      const otherRequest: OpenApeGrantRequest = {
        requester: 'other@example.com',
        target_host: 'macmini',
        audience: 'apes',
        grant_type: 'once',
      }
      await createGrant(otherRequest, store)

      const grants = await store.findByRequester('agent@example.com')
      expect(grants).toHaveLength(1)
    })

    it('throws when updating non-existent grant', async () => {
      await expect(
        store.updateStatus('non-existent', 'approved'),
      ).rejects.toThrow('Grant not found')
    })

    describe('listGrants', () => {
      it('returns paginated grants sorted by created_at DESC', async () => {
        // Use store.save directly with distinct timestamps to ensure ordering
        const g1 = { id: 'g-old', request: onceRequest, status: 'pending' as const, created_at: 1000 }
        const g2 = { id: 'g-new', request: timedRequest, status: 'pending' as const, created_at: 2000 }
        await store.save(g1)
        await store.save(g2)

        const result = await store.listGrants()
        expect(result.data).toHaveLength(2)
        // Newest first
        expect(result.data[0]!.id).toBe('g-new')
        expect(result.data[1]!.id).toBe('g-old')
        expect(result.pagination.has_more).toBe(false)
      })

      it('filters by status', async () => {
        const g1 = await createGrant(onceRequest, store)
        await createGrant(timedRequest, store)
        await approveGrant(g1.id, 'admin@example.com', store)

        const result = await store.listGrants({ status: 'approved' })
        expect(result.data).toHaveLength(1)
        expect(result.data[0]!.id).toBe(g1.id)
      })

      it('filters by requester', async () => {
        await createGrant(onceRequest, store)
        await createGrant({ ...onceRequest, requester: 'other@example.com' }, store)

        const result = await store.listGrants({ requester: 'agent@example.com' })
        expect(result.data).toHaveLength(1)
      })

      it('respects limit parameter', async () => {
        await createGrant(onceRequest, store)
        await createGrant(timedRequest, store)
        await createGrant(alwaysRequest, store)

        const result = await store.listGrants({ limit: 2 })
        expect(result.data).toHaveLength(2)
        expect(result.pagination.has_more).toBe(true)
      })

      it('clamps limit to minimum 1 and maximum 100', async () => {
        await createGrant(onceRequest, store)

        const resultMin = await store.listGrants({ limit: 0 })
        expect(resultMin.data).toHaveLength(1)

        const resultMax = await store.listGrants({ limit: 200 })
        expect(resultMax.data).toHaveLength(1)
      })

      it('supports cursor-based pagination', async () => {
        // Create grants with different timestamps
        const g1 = await createGrant(onceRequest, store)
        // Force different created_at by directly saving
        await store.save({ ...g1, id: 'grant-early', created_at: 1000 })
        await store.save({ ...g1, id: 'grant-mid', created_at: 2000 })
        await store.save({ ...g1, id: 'grant-late', created_at: 3000 })

        const page1 = await store.listGrants({ limit: 1 })
        expect(page1.data).toHaveLength(1)
        expect(page1.pagination.has_more).toBe(true)

        const page2 = await store.listGrants({ limit: 1, cursor: page1.pagination.cursor! })
        expect(page2.data).toHaveLength(1)
        expect(page2.data[0]!.created_at).toBeLessThan(page1.data[0]!.created_at)
      })

      it('returns empty results for cursor past all grants', async () => {
        await store.save({ ...await createGrant(onceRequest, store), id: 'g1', created_at: 1000 })

        const result = await store.listGrants({ cursor: '500' })
        expect(result.data).toHaveLength(0)
      })

      it('returns empty results with null cursor when no grants exist', async () => {
        const result = await store.listGrants()
        expect(result.data).toHaveLength(0)
        expect(result.pagination.cursor).toBeNull()
        expect(result.pagination.has_more).toBe(false)
      })
    })
  })

  describe('delegation grants', () => {
    it('creates a delegation grant (auto-approved)', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        scopes: ['account:read', 'account:balance'],
        grant_type: 'once',
      }, store)

      expect(grant.type).toBe('delegation')
      expect(grant.status).toBe('approved')
      expect(grant.request.delegator).toBe('patrick@hofmann.eco')
      expect(grant.request.delegate).toBe('agent+patrick@id.openape.at')
      expect(grant.request.audience).toBe('bank.example.com')
      expect(grant.request.scopes).toEqual(['account:read', 'account:balance'])
      expect(grant.decided_by).toBe('patrick@hofmann.eco')
    })

    it('creates timed delegation with expiry', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'lisa@firma.at',
        audience: 'email.firma.at',
        scopes: ['email:read', 'email:send'],
        grant_type: 'timed',
        duration: 86400,
      }, store)

      expect(grant.status).toBe('approved')
      expect(grant.expires_at).toBeDefined()
    })

    it('validates delegation grant for correct delegate', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)

      const validated = await validateDelegation(
        grant.id,
        'agent+patrick@id.openape.at',
        'bank.example.com',
        store,
      )
      expect(validated.id).toBe(grant.id)
    })

    it('throws for non-existent delegation grant', async () => {
      await expect(validateDelegation(
        'non-existent',
        'agent+patrick@id.openape.at',
        'bank.example.com',
        store,
      )).rejects.toThrow('Delegation grant not found')
    })

    it('rejects delegation for wrong delegate', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)

      await expect(validateDelegation(
        grant.id,
        'other-agent@id.openape.at',
        'bank.example.com',
        store,
      )).rejects.toThrow('Delegate does not match')
    })

    it('rejects delegation for wrong audience', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)

      await expect(validateDelegation(
        grant.id,
        'agent+patrick@id.openape.at',
        'other.example.com',
        store,
      )).rejects.toThrow('Audience does not match')
    })

    it('allows wildcard audience', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: '*',
        grant_type: 'always',
      }, store)

      const validated = await validateDelegation(
        grant.id,
        'agent+patrick@id.openape.at',
        'any-sp.example.com',
        store,
      )
      expect(validated.id).toBe(grant.id)
    })

    it('rejects revoked delegation', async () => {
      const grant = await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)

      await revokeGrant(grant.id, store)

      await expect(validateDelegation(
        grant.id,
        'agent+patrick@id.openape.at',
        'bank.example.com',
        store,
      )).rejects.toThrow('not approved')
    })

    it('rejects non-delegation grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)

      await expect(validateDelegation(
        grant.id,
        'agent@example.com',
        'api.example.com',
        store,
      )).rejects.toThrow('Not a delegation grant')
    })

    it('findByDelegate returns delegation grants', async () => {
      await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)
      await createGrant(onceRequest, store)

      const grants = await store.findByDelegate('agent+patrick@id.openape.at')
      expect(grants).toHaveLength(1)
      expect(grants[0].type).toBe('delegation')
    })

    it('findByDelegator returns delegation grants', async () => {
      await createDelegation({
        delegator: 'patrick@hofmann.eco',
        delegate: 'agent+patrick@id.openape.at',
        audience: 'bank.example.com',
        grant_type: 'always',
      }, store)
      await createGrant(onceRequest, store)

      const grants = await store.findByDelegator('patrick@hofmann.eco')
      expect(grants).toHaveLength(1)
      expect(grants[0].request.delegate).toBe('agent+patrick@id.openape.at')
    })
  })

  describe('approveGrantWithExtension', () => {
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

    const oldRequest: OpenApeGrantRequest = {
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
    }

    const newRequest: OpenApeGrantRequest = {
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

    it('widen: revokes old grant and approves pending with wildcard', async () => {
      const oldGrant = await createGrant(oldRequest, store)
      await approveGrant(oldGrant.id, 'admin@example.com', store, { grant_type: 'always' })

      const pendingGrant = await createGrant(newRequest, store)

      const result = await approveGrantWithExtension(
        pendingGrant.id,
        'admin@example.com',
        store,
        { extend_mode: 'widen', extend_grant_ids: [oldGrant.id], grant_type: 'always' },
      )

      expect(result.status).toBe('approved')
      const perms = result.request.permissions ?? []
      expect(perms).toContain('gh.owner[login=openape].repo[*]#list')

      const revokedOld = await store.findById(oldGrant.id)
      expect(revokedOld!.status).toBe('revoked')
    })

    it('merge: revokes old grant and approves pending with combined details', async () => {
      const oldGrant = await createGrant(oldRequest, store)
      await approveGrant(oldGrant.id, 'admin@example.com', store, { grant_type: 'always' })

      const pendingGrant = await createGrant(newRequest, store)

      const result = await approveGrantWithExtension(
        pendingGrant.id,
        'admin@example.com',
        store,
        { extend_mode: 'merge', extend_grant_ids: [oldGrant.id], grant_type: 'always' },
      )

      expect(result.status).toBe('approved')
      const perms = result.request.permissions ?? []
      expect(perms).toContain('gh.owner[login=openape].repo[name=cli]#list')
      expect(perms).toContain('gh.owner[login=openape].repo[name=docs]#list')

      const revokedOld = await store.findById(oldGrant.id)
      expect(revokedOld!.status).toBe('revoked')
    })

    it('rejects if pending grant not found', async () => {
      await expect(
        approveGrantWithExtension('nonexistent', 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: ['x'],
          grant_type: 'always',
        }),
      ).rejects.toThrow('Grant not found')
    })

    it('rejects if extend grant has different target_host', async () => {
      const mismatchRequest: OpenApeGrantRequest = {
        ...oldRequest,
        target_host: 'other-host',
      }
      const oldGrant = await createGrant(mismatchRequest, store)
      await approveGrant(oldGrant.id, 'admin@example.com', store, { grant_type: 'always' })

      const pendingGrant = await createGrant(newRequest, store)

      await expect(
        approveGrantWithExtension(pendingGrant.id, 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: [oldGrant.id],
          grant_type: 'always',
        }),
      ).rejects.toThrow('target_host mismatch')
    })

    it('rejects if extend_grant_id not found', async () => {
      const pendingGrant = await createGrant(newRequest, store)

      await expect(
        approveGrantWithExtension(pendingGrant.id, 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: ['nonexistent'],
          grant_type: 'always',
        }),
      ).rejects.toThrow('Extend grant not found')
    })

    it('rejects if extend_grant_id is not approved', async () => {
      const oldGrant = await createGrant(oldRequest, store)
      const pendingGrant = await createGrant(newRequest, store)

      await expect(
        approveGrantWithExtension(pendingGrant.id, 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: [oldGrant.id],
          grant_type: 'always',
        }),
      ).rejects.toThrow('Extend grant is not approved')
    })

    it('rejects if pending grant is not pending', async () => {
      const oldGrant = await createGrant(oldRequest, store)
      await approveGrant(oldGrant.id, 'admin@example.com', store, { grant_type: 'always' })

      const alreadyApproved = await createGrant(newRequest, store)
      await approveGrant(alreadyApproved.id, 'admin@example.com', store, { grant_type: 'always' })

      await expect(
        approveGrantWithExtension(alreadyApproved.id, 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: [oldGrant.id],
          grant_type: 'always',
        }),
      ).rejects.toThrow('Grant is not pending')
    })

    it('rejects if extend grant has different audience', async () => {
      const mismatchRequest: OpenApeGrantRequest = {
        ...oldRequest,
        audience: 'proxy',
      }
      const oldGrant = await createGrant(mismatchRequest, store)
      await approveGrant(oldGrant.id, 'admin@example.com', store, { grant_type: 'always' })

      const pendingGrant = await createGrant(newRequest, store)

      await expect(
        approveGrantWithExtension(pendingGrant.id, 'admin@example.com', store, {
          extend_mode: 'widen',
          extend_grant_ids: [oldGrant.id],
          grant_type: 'always',
        }),
      ).rejects.toThrow('audience mismatch')
    })

    it('handles multiple extend_grant_ids', async () => {
      const oldGrant1 = await createGrant(oldRequest, store)
      await approveGrant(oldGrant1.id, 'admin@example.com', store, { grant_type: 'always' })

      const oldRequest2: OpenApeGrantRequest = {
        ...oldRequest,
        authorization_details: [makeCliDetail({
          resource_chain: [
            { resource: 'owner', selector: { login: 'openape' } },
            { resource: 'repo', selector: { name: 'api' } },
          ],
          permission: 'gh.owner[login=openape].repo[name=api]#list',
        })],
      }
      const oldGrant2 = await createGrant(oldRequest2, store)
      await approveGrant(oldGrant2.id, 'admin@example.com', store, { grant_type: 'always' })

      const pendingGrant = await createGrant(newRequest, store)

      const result = await approveGrantWithExtension(
        pendingGrant.id,
        'admin@example.com',
        store,
        { extend_mode: 'merge', extend_grant_ids: [oldGrant1.id, oldGrant2.id], grant_type: 'always' },
      )

      expect(result.status).toBe('approved')
      const perms = result.request.permissions ?? []
      expect(perms).toContain('gh.owner[login=openape].repo[name=cli]#list')
      expect(perms).toContain('gh.owner[login=openape].repo[name=docs]#list')
      expect(perms).toContain('gh.owner[login=openape].repo[name=api]#list')

      expect((await store.findById(oldGrant1.id))!.status).toBe('revoked')
      expect((await store.findById(oldGrant2.id))!.status).toBe('revoked')
    })
  })

  describe('approveGrantWithWidening', () => {
    function fsDetail(path: string): OpenApeCliAuthorizationDetail {
      const base = {
        type: 'openape_cli' as const,
        cli_id: 'rm',
        operation_id: 'rm.delete',
        resource_chain: [{ resource: 'filesystem', selector: { path } }],
        action: 'delete',
        display: `Remove ${path}`,
        risk: 'medium' as const,
      }
      return {
        ...base,
        permission: `rm.filesystem[path=${path}]#delete`,
      }
    }

    function wildcardDetail(path: string): OpenApeCliAuthorizationDetail {
      // widened variant — caller sets cli_id, action, operation_id identical
      return {
        type: 'openape_cli',
        cli_id: 'rm',
        operation_id: 'rm.delete',
        resource_chain: [{ resource: 'filesystem', selector: { path } }],
        action: 'delete',
        display: `Remove anything matching ${path}`,
        risk: 'medium',
        permission: `rm.filesystem[path=${path}]#delete`,
      }
    }

    const originalRequest = (path: string): OpenApeGrantRequest => ({
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      authorization_details: [fsDetail(path)],
      command: ['rm', path],
      cmd_hash: 'SHA-256:dummy',
    })

    it('replaces the pending grant details with the widened ones and approves', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)

      // Widen to /tmp/** — a valid superset of /tmp/foo.txt? Actually
      // cliAuthorizationDetailCovers checks literal equality of selector values,
      // so /tmp/** does not cover /tmp/foo.txt at the selector level. The
      // expected semantic widening is "drop the selector key entirely" for the
      // widest scope, and the UI picks that as wildcard. Validate with wildcard.
      const wild: OpenApeCliAuthorizationDetail = {
        type: 'openape_cli',
        cli_id: 'rm',
        operation_id: 'rm.delete',
        resource_chain: [{ resource: 'filesystem' }],
        action: 'delete',
        display: 'Remove any file',
        risk: 'medium',
        permission: 'rm.filesystem[*]#delete',
      }

      const approved = await approveGrantWithWidening(pending.id, 'admin@example.com', store, [wild])

      expect(approved.status).toBe('approved')
      const detail = approved.request.authorization_details![0] as OpenApeCliAuthorizationDetail
      expect(detail.resource_chain[0]!.selector).toBeUndefined()
      expect(detail.permission).toBe('rm.filesystem[*]#delete')
      expect(approved.request.command).toBeUndefined()
      expect(approved.request.cmd_hash).toBeUndefined()
      expect(approved.request.permissions).toEqual(['rm.filesystem[*]#delete'])
    })

    it('accepts exact widening (caller chose "exact" scope — no widening)', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const exact = fsDetail('/tmp/foo.txt')
      const approved = await approveGrantWithWidening(pending.id, 'admin@example.com', store, [exact])
      expect(approved.status).toBe('approved')
      const detail = approved.request.authorization_details![0] as OpenApeCliAuthorizationDetail
      expect(detail.resource_chain[0]!.selector).toEqual({ path: '/tmp/foo.txt' })
    })

    it('rejects when pending grant not found', async () => {
      await expect(
        approveGrantWithWidening('nonexistent', 'admin@example.com', store, [wildcardDetail('/tmp/*')]),
      ).rejects.toThrow('Grant not found')
    })

    it('rejects when grant is not pending', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      await approveGrant(pending.id, 'admin@example.com', store)
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [fsDetail('/tmp/foo.txt')]),
      ).rejects.toThrow('Grant is not pending')
    })

    it('rejects when pending grant has no cli details', async () => {
      const pending = await createGrant({
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'once',
      }, store)
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [fsDetail('/tmp/foo.txt')]),
      ).rejects.toThrow('no CLI authorization details')
    })

    it('rejects when widened_details length mismatches', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [fsDetail('/tmp/foo.txt'), fsDetail('/tmp/bar.txt')]),
      ).rejects.toThrow('length mismatch')
    })

    it('rejects widened_detail with wrong type', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const bad = { ...fsDetail('/tmp/foo.txt'), type: 'openape_grant' as unknown as 'openape_cli' }
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('type must be')
    })

    it('rejects widened_detail with wrong cli_id', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const bad: OpenApeCliAuthorizationDetail = { ...fsDetail('/tmp/foo.txt'), cli_id: 'ls' }
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('cli_id mismatch')
    })

    it('rejects widened_detail with wrong action', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const bad: OpenApeCliAuthorizationDetail = { ...fsDetail('/tmp/foo.txt'), action: 'read' }
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('action mismatch')
    })

    it('rejects widened_detail with wrong operation_id', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const bad: OpenApeCliAuthorizationDetail = { ...fsDetail('/tmp/foo.txt'), operation_id: 'rm.force' }
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('operation_id mismatch')
    })

    it('rejects widened_detail with mismatched resource_chain structure', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const bad: OpenApeCliAuthorizationDetail = {
        ...fsDetail('/tmp/foo.txt'),
        resource_chain: [
          { resource: 'host', selector: { hostname: 'x' } },
          { resource: 'filesystem', selector: { path: '/tmp/foo.txt' } },
        ],
      }
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('resource_chain structure mismatch')
    })

    it('rejects widened_detail that does not cover the original', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      // A different concrete path is NOT a widening — must be rejected.
      const bad = fsDetail('/etc/passwd')
      await expect(
        approveGrantWithWidening(pending.id, 'admin@example.com', store, [bad]),
      ).rejects.toThrow('does not cover original')
    })

    it('recomputes canonical permission server-side (ignores client-provided value)', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const wild: OpenApeCliAuthorizationDetail = {
        type: 'openape_cli',
        cli_id: 'rm',
        operation_id: 'rm.delete',
        resource_chain: [{ resource: 'filesystem' }],
        action: 'delete',
        display: 'Wildcard',
        risk: 'medium',
        // Client tries to forge a different permission — server must ignore and recompute
        permission: 'rm.filesystem[path=pwned]#delete',
      }
      const approved = await approveGrantWithWidening(pending.id, 'admin@example.com', store, [wild])
      const detail = approved.request.authorization_details![0] as OpenApeCliAuthorizationDetail
      expect(detail.permission).toBe('rm.filesystem[*]#delete')
    })

    it('passes through grant_type and duration overrides', async () => {
      const pending = await createGrant(originalRequest('/tmp/foo.txt'), store)
      const wild: OpenApeCliAuthorizationDetail = {
        type: 'openape_cli',
        cli_id: 'rm',
        operation_id: 'rm.delete',
        resource_chain: [{ resource: 'filesystem' }],
        action: 'delete',
        display: 'Wildcard',
        risk: 'medium',
        permission: 'rm.filesystem[*]#delete',
      }
      const approved = await approveGrantWithWidening(
        pending.id,
        'admin@example.com',
        store,
        [wild],
        { grant_type: 'timed', duration: 3600 },
      )
      expect(approved.request.grant_type).toBe('timed')
      expect(approved.request.duration).toBe(3600)
      expect(approved.expires_at).toBeDefined()
    })
  })
})
