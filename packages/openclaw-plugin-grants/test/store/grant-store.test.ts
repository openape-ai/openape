import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GrantStore } from '../../src/store/grant-store.js'

describe('GrantStore', () => {
  describe('in-memory (no stateDir)', () => {
    let store: GrantStore

    beforeEach(() => {
      store = new GrantStore()
    })

    it('creates a grant', () => {
      const grant = store.createGrant({
        permission: 'gh.owner[login=openape].repo[*]#list',
        command: 'gh repo list openape',
        reason: 'List repos',
        risk: 'low',
        display: 'List repositories for openape',
      })

      expect(grant.id).toBeDefined()
      expect(grant.status).toBe('pending')
      expect(grant.permission).toBe('gh.owner[login=openape].repo[*]#list')
    })

    it('approves a grant', () => {
      const grant = store.createGrant({
        permission: 'test.perm#list',
        command: 'test list',
        risk: 'low',
        display: 'Test',
      })

      const approved = store.approveGrant(grant.id, 'once')
      expect(approved).not.toBeNull()
      expect(approved!.status).toBe('approved')
      expect(approved!.approval).toBe('once')
      expect(approved!.decidedAt).toBeDefined()
    })

    it('denies a grant', () => {
      const grant = store.createGrant({
        permission: 'test.perm#delete',
        command: 'test delete',
        risk: 'high',
        display: 'Test',
      })

      const denied = store.denyGrant(grant.id)
      expect(denied).not.toBeNull()
      expect(denied!.status).toBe('denied')
    })

    it('consumes a once-grant', () => {
      const grant = store.createGrant({
        permission: 'test#exec',
        command: 'test exec',
        risk: 'low',
        display: 'Test',
      })
      store.approveGrant(grant.id, 'once')

      const consumed = store.consumeGrant(grant.id)
      expect(consumed).toBe(true)

      const updated = store.getGrant(grant.id)
      expect(updated!.status).toBe('used')
    })

    it('does not consume a timed-grant', () => {
      const grant = store.createGrant({
        permission: 'test#exec',
        command: 'test exec',
        risk: 'low',
        display: 'Test',
      })
      store.approveGrant(grant.id, 'timed', new Date(Date.now() + 3600_000).toISOString())

      store.consumeGrant(grant.id)
      const updated = store.getGrant(grant.id)
      expect(updated!.status).toBe('approved') // still approved
    })

    it('revokes a grant', () => {
      const grant = store.createGrant({
        permission: 'test#exec',
        command: 'test exec',
        risk: 'low',
        display: 'Test',
      })
      store.approveGrant(grant.id, 'always')

      const revoked = store.revokeGrant(grant.id)
      expect(revoked).toBe(true)
      expect(store.getGrant(grant.id)!.status).toBe('revoked')
    })

    it('lists grants by status', () => {
      store.createGrant({ permission: 'a#list', command: 'a', risk: 'low', display: 'A' })
      const g2 = store.createGrant({ permission: 'b#list', command: 'b', risk: 'low', display: 'B' })
      store.approveGrant(g2.id, 'once')

      expect(store.listGrants({ status: 'pending' })).toHaveLength(1)
      expect(store.listGrants({ status: 'approved' })).toHaveLength(1)
      expect(store.listGrants()).toHaveLength(2)
    })

    it('returns null for double-approve', () => {
      const grant = store.createGrant({ permission: 'x#y', command: 'x', risk: 'low', display: 'X' })
      store.approveGrant(grant.id, 'once')
      const result = store.approveGrant(grant.id, 'always')
      expect(result).toBeNull()
    })
  })

  describe('persistent (with stateDir)', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'grant-store-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('persists grants across instances', () => {
      const store1 = new GrantStore(tempDir)
      const grant = store1.createGrant({
        permission: 'test#list',
        command: 'test list',
        risk: 'low',
        display: 'Test',
      })
      store1.approveGrant(grant.id, 'always')

      const store2 = new GrantStore(tempDir)
      const reloaded = store2.getGrant(grant.id)
      expect(reloaded).toBeDefined()
      expect(reloaded!.status).toBe('approved')
    })
  })
})
