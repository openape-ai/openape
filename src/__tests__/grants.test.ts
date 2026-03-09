import type { OpenApeGrantRequest } from '@openape/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  approveGrant,
  createGrant,
  denyGrant,
  introspectGrant,
  revokeGrant,
  useGrant,
} from '../grants.js'
import { InMemoryGrantStore } from '../stores.js'

describe('grant lifecycle', () => {
  let store: InMemoryGrantStore

  const onceRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target: 'api.example.com',
    grant_type: 'once',
    permissions: ['read'],
    reason: 'Need to read data',
  }

  const timedRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target: 'api.example.com',
    grant_type: 'timed',
    permissions: ['read', 'write'],
    duration: 3600, // 1 hour
  }

  const alwaysRequest: OpenApeGrantRequest = {
    requester: 'agent@example.com',
    target: 'api.example.com',
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
  })

  describe('revokeGrant', () => {
    it('revokes an approved grant', async () => {
      const grant = await createGrant(onceRequest, store)
      await approveGrant(grant.id, 'admin@example.com', store)
      const revoked = await revokeGrant(grant.id, store)

      expect(revoked.status).toBe('revoked')
    })

    it('rejects revocation of non-approved grant', async () => {
      const grant = await createGrant(onceRequest, store)

      await expect(revokeGrant(grant.id, store)).rejects.toThrow(
        'Grant is not approved',
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
        target: 'api.example.com',
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
      target: 'sp.example.com',
      grant_type: 'once',
      permissions: ['delegate'],
      reason: 'Login als Owner bei sp.example.com',
    }

    const delegateTimedRequest: OpenApeGrantRequest = {
      requester: 'agent@example.com',
      target: 'sp.example.com',
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
        target: 'api.example.com',
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
  })
})
