import { describe, expect, it } from 'vitest'
import { assertGrantReferenceRequest, grantReferenceBinding, grantReferenceKey, parseGrantReference } from '../src/grant-reference.js'
import { InMemoryGrantStore } from '../src/stores.js'
import { approveGrant, approveGrantWithExtension, createGrant } from '../src/grants.js'
import type { OpenApeGrantRequest } from '@openape/core'

const request: OpenApeGrantRequest = { requester: 'exporter@example.test', target_host: 'fixture', audience: 'documents', grant_type: 'once', command: ['render', 'document-42'], reference: 'document-42:export:v1' }
describe('generic reference contract', () => {
  it('counts UTF-8 bytes, preserves opaque syntax and refuses hidden input', () => {
    expect(parseGrantReference('client/document-42/export:v1')).toBe('client/document-42/export:v1')
    expect(parseGrantReference('ä'.repeat(256))).toHaveLength(256)
    for (const value of ['', ' ', null, 42, 'ä'.repeat(257), 'a'.repeat(513), 'a\n', 'a\u202E', '\uD800']) expect(() => parseGrantReference(value)).toThrow()
    expect(parseGrantReference(undefined)).toBeUndefined()
  })
  it('normalizes object ordering while keeping command order and authority distinct from presentation', () => {
    expect(grantReferenceBinding(request)).toBe(grantReferenceBinding({ command: request.command, ...request, summary: { title: 'New presentation' }, batch: { id: 'new-run' } }))
    expect(grantReferenceBinding(request)).not.toBe(grantReferenceBinding({ ...request, command: [...request.command!].reverse() }))
    expect(() => assertGrantReferenceRequest({ ...request, grant_type: 'always' })).toThrow()
    expect(() => assertGrantReferenceRequest({ ...request, run_as: 'other-user' })).toThrow()
  })
  it('includes every broker authority field and excludes its display name', () => {
    const broker = { connection_id: 'connection', owner: 'owner@example.test', broker_issuer: 'https://broker.test', agent_issuer: 'https://broker.test', key_id: 'key' }
    const key = grantReferenceKey(request.requester, request.reference!, broker)
    for (const field of Object.keys(broker)) expect(grantReferenceKey(request.requester, request.reference!, { ...broker, [field]: 'other' })).not.toBe(key)
    expect(grantReferenceKey(request.requester, request.reference!, { ...broker, requester_name: 'New display name' })).toBe(key)
    expect(grantReferenceKey(request.requester, request.reference!)).not.toBe(key)
  })
  it('deduplicates memory callers and rejects approval widening before changing any decision', async () => {
    const store = new InMemoryGrantStore()
    const grants = await Promise.all(Array.from({ length: 5 }, () => createGrant(request, store)))
    expect(new Set(grants.map(grant => grant.id)).size).toBe(1)
    const id = grants[0]!.id
    for (const reference of [undefined, 'replacement'])
      await expect(store.updateStatus(id, 'pending', { request: { ...request, reference } })).rejects.toThrow('different authorization request')
    await expect(approveGrant(id, 'owner', store, { grant_type: 'always' })).rejects.toThrow('exact single-use')
    await expect(approveGrantWithExtension(id, 'owner', store, { extend_mode: 'merge', extend_grant_ids: ['another'] })).rejects.toThrow('cannot be widened')
    expect((await store.findById(id))?.status).toBe('pending')
  })
})
