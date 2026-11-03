// Owner-published shapes on the grant card (issue 1551): the card says the
// owner's own shape resolved the grant and lists every operation it declares.
import type { OpenApeGrant } from '@openape/core'
import type { ServerShape } from '@openape/grants'
import { createInMemoryShapeStore, ownerScopedShapeStore, resolveProgramCall } from '@openape/grants'
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
  const call = await resolveProgramCall(ownerScopedShapeStore(store, owner), { program: { name: 'jev', sha256: 'a'.repeat(64) }, argv: ['ask'] })
  return { id: 'g1', status: 'pending', type: 'command', created_at: 1, request: { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always', permissions: [call.detail.permission], authorization_details: [call.detail], command: call.executionArgv, execution_context: call.executionContext } }
}

describe('owner shape card', () => {
  it('marks the owner shape, lists its operations and flags a later change', async () => {
    const store = createInMemoryShapeStore()
    await store.saveOwnerShape!(owner, jev)
    const grant = await grantFor(store)
    const sources = { getShape: (cliId: string, shapeOwner?: string) => ownerScopedShapeStore(store, shapeOwner).getShape(cliId), findUser: async () => null }
    const [card] = await withGrantCards([grant], sources)
    expect(card!.card.owner_shape).toEqual({
      cli_id: 'jev',
      owner,
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

  it('has no owner shape for registry or client-resolved grants', async () => {
    const store = createInMemoryShapeStore()
    await store.saveOwnerShape!(owner, jev)
    const grant = await grantFor(store)
    // A client cannot write adapter_owner; without the IdP's program hash the field is ignored.
    const { program_sha256: _sha, ...clientContext } = grant.request.execution_context!
    const sources = { getShape: async () => null, findUser: async () => null }
    expect((await withGrantCards([{ ...grant, request: { ...grant.request, execution_context: clientContext } }], sources))[0]!.card.owner_shape).toBeNull()
  })
})
