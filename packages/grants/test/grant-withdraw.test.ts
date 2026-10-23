import type { BrokeredGrant, OpenApeGrantRequest } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { approveGrant, denyGrant, grantReferenceKey, InMemoryGrantStore, InvalidGrantWithdrawError, parseBrokerRequest, parseGrantWithdrawRequest, parseGrantWithdrawResult, useGrant, withdrawReferencedGrant } from '../src/index.js'

const request = (reference: string, requester = 'pod@pods.example'): OpenApeGrantRequest => ({ requester, target_host: 'mac', audience: 'shapes', grant_type: 'once', command: ['o365-cli', 'workflow', 'archive', reference], reference, batch: { id: 'archive' } })
const binding: BrokeredGrant = { connection_id: '6f2c1f8e-2f4a-4b8e-9c55-2a9a0b1c3d4e', broker_issuer: 'https://pods.example', agent_issuer: 'https://pods.example', owner: 'owner@example', key_id: 'key-1' }

async function created(store: InMemoryGrantStore, reference: string, requester?: string, brokered?: BrokeredGrant) {
  const { grant } = await store.createReferenced({ id: crypto.randomUUID(), type: 'command', request: request(reference, requester), status: 'pending', created_at: 1, ...(brokered ? { brokered } : {}) })
  return grant
}

describe('withdrawReferencedGrant (grants.md §4.11)', () => {
  it('withdraws a pending request once, refuses its approval and repeats as a no-op', async () => {
    const store = new InMemoryGrantStore()
    const grant = await created(store, 'mail-1')
    const key = grantReferenceKey(grant.request.requester, 'mail-1')
    expect(await withdrawReferencedGrant(key, 'mail left the Inbox', store)).toEqual({ outcome: 'withdrawn', grant_id: grant.id, previous_status: 'pending' })
    expect(await store.findById(grant.id)).toMatchObject({ status: 'withdrawn', withdraw_reason: 'mail left the Inbox', decided_at: expect.any(Number) })
    await expect(approveGrant(grant.id, 'owner@example', store)).rejects.toThrow('not pending')
    await expect(denyGrant(grant.id, 'owner@example', store)).rejects.toThrow('not pending')
    expect(await withdrawReferencedGrant(key, 'again', store)).toEqual({ outcome: 'withdrawn', grant_id: grant.id, previous_status: 'withdrawn' })
    expect((await store.findById(grant.id))?.withdraw_reason).toBe('mail left the Inbox')
    expect(await store.findPending()).toEqual([])
  })

  it('withdraws an approved but unused single-use grant, which can then not be used', async () => {
    const store = new InMemoryGrantStore()
    const grant = await created(store, 'mail-2')
    await approveGrant(grant.id, 'owner@example', store)
    expect(await withdrawReferencedGrant(grantReferenceKey(grant.request.requester, 'mail-2'), undefined, store)).toEqual({ outcome: 'withdrawn', grant_id: grant.id, previous_status: 'approved' })
    expect(await store.claimOnce(grant.id, 2)).toBe(false)
    await expect(useGrant(grant.id, store)).rejects.toThrow('not approved')
  })

  it.each(['used', 'denied', 'revoked', 'expired'] as const)('leaves a %s request unchanged and reports it', async (status) => {
    const store = new InMemoryGrantStore()
    const grant = await created(store, `mail-${status}`)
    await store.updateStatus(grant.id, status)
    expect(await withdrawReferencedGrant(grantReferenceKey(grant.request.requester, `mail-${status}`), undefined, store)).toEqual({ outcome: 'already_decided', grant_id: grant.id, status })
    expect((await store.findById(grant.id))?.status).toBe(status)
  })

  it('never reaches the request of another requester or another broker binding', async () => {
    const store = new InMemoryGrantStore()
    const mine = await created(store, 'shared-name', 'pod-a@pods.example', binding)
    expect(await withdrawReferencedGrant(grantReferenceKey('pod-b@pods.example', 'shared-name', binding), undefined, store)).toEqual({ outcome: 'unknown' })
    expect(await withdrawReferencedGrant(grantReferenceKey('pod-a@pods.example', 'shared-name'), undefined, store)).toEqual({ outcome: 'unknown' })
    expect(await withdrawReferencedGrant(grantReferenceKey('pod-a@pods.example', 'shared-name', { ...binding, key_id: 'key-2' }), undefined, store)).toEqual({ outcome: 'unknown' })
    expect((await store.findById(mine.id))?.status).toBe('pending')
    expect(await withdrawReferencedGrant(grantReferenceKey('pod-a@pods.example', 'shared-name', binding), undefined, store)).toMatchObject({ outcome: 'withdrawn' })
  })

  it('keeps a withdrawn reference bound: the same reference never creates a new request', async () => {
    const store = new InMemoryGrantStore()
    const grant = await created(store, 'mail-3')
    await withdrawReferencedGrant(grantReferenceKey(grant.request.requester, 'mail-3'), undefined, store)
    const again = await store.createReferenced({ id: crypto.randomUUID(), type: 'command', request: request('mail-3'), status: 'pending', created_at: 2 })
    expect(again).toMatchObject({ created: false, grant: { id: grant.id, status: 'withdrawn' } })
  })
})

describe('withdrawal input and answers', () => {
  it('accepts exactly a reference and an optional reason', () => {
    expect(parseGrantWithdrawRequest({ reference: 'mail-1' })).toEqual({ reference: 'mail-1' })
    expect(parseGrantWithdrawRequest({ reference: 'mail-1', reason: 'archived by hand' })).toEqual({ reference: 'mail-1', reason: 'archived by hand' })
    for (const input of [null, [], {}, { reference: '' }, { reference: 'a\u0000b' }, { reference: 'x'.repeat(513) }, { reference: 'mail', grant_id: 'x' }, { reference: 'mail', reason: '' }, { reference: 'mail', reason: ' ' }, { reference: 'mail', reason: 'line\nbreak' }, { reference: 'mail', reason: 'bidi‮' }, { reference: 'mail', reason: 'x'.repeat(501) }, { reference: 'mail', reason: 7 }])
      expect(() => parseGrantWithdrawRequest(input), JSON.stringify(input)).toThrow(InvalidGrantWithdrawError)
  })

  it('reads only well-formed answers', () => {
    expect(parseGrantWithdrawResult({ outcome: 'unknown' })).toEqual({ outcome: 'unknown' })
    expect(parseGrantWithdrawResult({ outcome: 'withdrawn', grant_id: 'g', previous_status: 'approved' })).toEqual({ outcome: 'withdrawn', grant_id: 'g', previous_status: 'approved' })
    expect(parseGrantWithdrawResult({ outcome: 'already_decided', grant_id: 'g', status: 'used' })).toEqual({ outcome: 'already_decided', grant_id: 'g', status: 'used' })
    for (const answer of [null, {}, { outcome: 'withdrawn', grant_id: 'g' }, { outcome: 'withdrawn', grant_id: 'g', previous_status: 'denied' }, { outcome: 'already_decided', grant_id: 'g', status: 'pending' }, { outcome: 'unknown', grant_id: 'g' }, { outcome: 'withdrawn', grant_id: '', previous_status: 'pending' }])
      expect(() => parseGrantWithdrawResult(answer), JSON.stringify(answer)).toThrow(InvalidGrantWithdrawError)
  })

  it('parses the signed broker withdraw operation strictly', () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = { iss: 'https://pods.example', aud: 'https://id.example', iat: now, exp: now + 30, jti: crypto.randomUUID(), connection_id: binding.connection_id, owner: 'owner@example', operation: 'withdraw', sub: 'pod@pods.example', key_id: 'key-1', reference: 'mail-1' }
    expect(parseBrokerRequest({ ...claims, reason: 'archived' })).toMatchObject({ operation: 'withdraw', reference: 'mail-1', reason: 'archived' })
    expect(() => parseBrokerRequest({ ...claims, reference: undefined })).toThrow()
    expect(() => parseBrokerRequest({ ...claims, grant_id: crypto.randomUUID() })).toThrow()
    expect(() => parseBrokerRequest({ ...claims, request: {} })).toThrow()
    expect(() => parseBrokerRequest({ ...claims, reason: 'a\u0007b' })).toThrow()
    expect(() => parseBrokerRequest({ ...claims, operation: 'get', reason: 'archived' })).toThrow()
  })
})
