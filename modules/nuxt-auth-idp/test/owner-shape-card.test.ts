// Owner-published shapes on the grant card (issue 1551): the card says the
// owner's own shape resolved the grant and lists every operation it declares.
import type { OpenApeGrant } from '@openape/core'
import type { ServerShape, ShapeScope } from '@openape/grants'
import { createInMemoryShapeStore, resolveProgramCall, scopedShapeStore, shapeScopeOf } from '@openape/grants'
import { describe, expect, it, vi } from 'vitest'
import { withGrantCards } from '../src/runtime/server/utils/grant-card'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))

const owner = 'owner@example.com'
const jev: ServerShape = {
  cli_id: 'jev',
  executable: 'jev',
  description: '',
  operations: [
    { id: 'ask', command: ['ask'], display: 'Ask Jev a structured question', action: 'read', risk: 'low', resource_chain: ['model:name=jev'] },
    { id: 'models', command: ['models'], display: 'List Jev models', action: 'list', risk: 'low', resource_chain: ['model'] },
  ],
  source: 'custom',
  digest: 'SHA-256:jev-v1',
  createdAt: 10,
  updatedAt: 20,
}

async function grantFor(store: ReturnType<typeof createInMemoryShapeStore>): Promise<OpenApeGrant> {
  const call = await resolveProgramCall(scopedShapeStore(store, shapeScopeOf(owner)), { program: { name: 'jev', sha256: 'a'.repeat(64) }, argv: ['ask'] })
  return { id: 'g1', status: 'pending', type: 'command', created_at: 1, request: { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always', permissions: [call.detail.permission], authorization_details: [call.detail], command: call.executionArgv, execution_context: call.executionContext } }
}

function sourcesFor(store: ReturnType<typeof createInMemoryShapeStore>) {
  return { listShapes: (scope: ShapeScope) => scopedShapeStore(store, scope).listShapes(), findUser: async () => null }
}

describe('owner shape card', () => {
  it('marks the owner shape, lists its operations and flags a later change', async () => {
    const store = createInMemoryShapeStore()
    await store.saveOwnerShape!(owner, jev)
    const grant = await grantFor(store)
    const sources = sourcesFor(store)
    const [card] = await withGrantCards([grant], sources)
    expect(card!.card.owner_shape).toEqual({
      cli_id: 'jev',
      tier: 'personal',
      owner,
      domain: null,
      published_by: null,
      overrides: null,
      digest: 'SHA-256:jev-v1',
      published_at: 20,
      current: true,
      operation_id: 'ask',
      operations: [
        { id: 'ask', command: ['ask'], display: 'Ask Jev a structured question', action: 'read', risk: 'low' },
        { id: 'models', command: ['models'], display: 'List Jev models', action: 'list', risk: 'low' },
      ],
    })
    await store.saveOwnerShape!(owner, { ...jev, digest: 'SHA-256:jev-v2', updatedAt: 30 })
    expect((await withGrantCards([grant], sources))[0]!.card.owner_shape).toMatchObject({ current: false, published_at: 30 })
    await store.deleteOwnerShape!(owner, 'jev')
    expect((await withGrantCards([grant], sources))[0]!.card.owner_shape).toMatchObject({ current: false, published_at: null, operations: [] })
  })

  it('never shows another tier\'s meaning for a grant a personal shape resolved, and names what it overrides', async () => {
    const store = createInMemoryShapeStore()
    const presented = (title: string) => jev.operations.map(op => ({ ...op, presentation: { title: { en: title, de: title } } as never }))
    await store.saveShape({ ...jev, source: 'builtin', digest: 'SHA-256:registry', operations: presented('Registry Jev') })
    await store.saveOwnerShape!(owner, { ...jev, operations: presented('Ask Jev') })
    const grant = await grantFor(store)
    const [before] = await withGrantCards([grant], sourcesFor(store))
    expect(before!.card.registry).not.toBeNull()
    expect(before!.card.owner_shape).toMatchObject({ tier: 'personal', overrides: 'instance', current: true })
    await store.saveDomainShape!('example.com', { ...jev, digest: 'SHA-256:domain', published_by: 'admin@example.com' })
    expect((await withGrantCards([grant], sourcesFor(store)))[0]!.card.owner_shape).toMatchObject({ overrides: 'domain' })
    // Removed: the domain shape now reads the owner's calls; it never speaks for the personal grant.
    await store.deleteOwnerShape!(owner, 'jev')
    const [card] = await withGrantCards([grant], sourcesFor(store))
    expect(card!.card.registry).toBeNull()
    expect(card!.card.owner_shape).toMatchObject({ current: false, overrides: null })
  })

  it('marks a domain shape with its domain and writer', async () => {
    const store = createInMemoryShapeStore([{ ...jev, source: 'builtin', digest: 'SHA-256:registry' }])
    await store.saveDomainShape!('example.com', { ...jev, digest: 'SHA-256:domain', published_by: 'admin@example.com' })
    const call = await resolveProgramCall(scopedShapeStore(store, shapeScopeOf('colleague@example.com')), { program: { name: 'jev', sha256: 'a'.repeat(64) }, argv: ['ask'] })
    const grant: OpenApeGrant = { id: 'g2', status: 'pending', type: 'command', created_at: 1, request: { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always', permissions: [call.detail.permission], authorization_details: [call.detail], command: call.executionArgv, execution_context: call.executionContext } }
    const sources = { ...sourcesFor(store), findUser: async (email: string) => ({ email, type: 'agent', owner: 'colleague@example.com' }) as never }
    expect((await withGrantCards([grant], sources))[0]!.card.owner_shape).toMatchObject({ tier: 'domain', owner: null, domain: 'example.com', published_by: 'admin@example.com', overrides: 'instance', current: true })
    // The requester's owner later publishes a personal shape for the program: the domain grant no longer applies.
    await store.saveOwnerShape!('colleague@example.com', { ...jev, digest: 'SHA-256:personal' })
    expect((await withGrantCards([grant], sources))[0]!.card.owner_shape).toMatchObject({ tier: 'domain', current: false, published_at: null })
  })

  it('has no owner shape for registry or client-resolved grants', async () => {
    const store = createInMemoryShapeStore()
    await store.saveOwnerShape!(owner, jev)
    const grant = await grantFor(store)
    // A client cannot write adapter_owner; without the IdP's program hash the field is ignored.
    const { program_sha256: _sha, ...clientContext } = grant.request.execution_context!
    const sources = { listShapes: async () => [], findUser: async () => null }
    expect((await withGrantCards([{ ...grant, request: { ...grant.request, execution_context: clientContext } }], sources))[0]!.card.owner_shape).toBeNull()
  })
})
