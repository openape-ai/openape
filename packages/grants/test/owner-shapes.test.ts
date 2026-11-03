// Owner-published shapes (issue 1551): an owner's own shapes resolve that
// owner's program calls after every registry shape and never for anyone else.
import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { approveGrantWithExtension } from '../src/grants.js'
import { InMemoryGrantStore } from '../src/stores.js'
import { resolveProgramCall } from '../src/program-authorization.js'
import { GENERIC_OPERATION_ID } from '../src/server-resolver.js'
import type { ServerShape } from '../src/shape-registry.js'
import { createInMemoryShapeStore, ownerScopedShapeStore } from '../src/shape-registry.js'

const hash = 'a'.repeat(64)
const registryGit: ServerShape = {
  cli_id: 'git',
  executable: 'git',
  description: 'Git CLI',
  operations: [{ id: 'git.status', command: ['status'], display: 'Show git status', action: 'read', risk: 'low', resource_chain: [] }],
  source: 'builtin',
  digest: 'SHA-256:registry-git',
  tested_digests: [`SHA-256:${'c'.repeat(64)}`],
  createdAt: 0,
  updatedAt: 0,
}
const jev: ServerShape = {
  cli_id: 'jev',
  executable: 'jev',
  description: '',
  operations: [{ id: 'ask', command: ['ask'], display: 'Ask Jev', action: 'read', risk: 'low', resource_chain: ['model:name=jev'] }],
  source: 'custom',
  digest: 'SHA-256:owner-jev',
  createdAt: 0,
  updatedAt: 0,
}

async function storeWithOwnerShapes() {
  const store = createInMemoryShapeStore([registryGit])
  await store.saveOwnerShape!('owner@example.com', jev)
  // A colliding owner shape (registry id) and one that claims a registry program hash.
  await store.saveOwnerShape!('owner@example.com', { ...jev, cli_id: 'git', executable: 'git', digest: 'SHA-256:owner-git' })
  await store.saveOwnerShape!('owner@example.com', { ...jev, cli_id: 'gitwrap', executable: 'gitwrap', tested_digests: registryGit.tested_digests })
  return store
}

describe('ownerScopedShapeStore', () => {
  it('adds only the owner\'s non-colliding shapes after the registry, without tested digests', async () => {
    const store = await storeWithOwnerShapes()
    const scoped = ownerScopedShapeStore(store, 'owner@example.com')
    const shapes = await scoped.listShapes()
    expect(shapes.map(shape => `${shape.source}:${shape.cli_id}`)).toEqual(['builtin:git', 'custom:gitwrap', 'custom:jev'])
    expect((await scoped.getShape('git'))?.digest).toBe('SHA-256:registry-git')
    expect((await scoped.getShape('jev'))?.owner).toBe('owner@example.com')
    expect((await scoped.getShape('gitwrap'))?.tested_digests).toBeUndefined()
    expect(await ownerScopedShapeStore(store, 'other@example.com').getShape('jev')).toBeNull()
    expect(ownerScopedShapeStore(store, undefined)).toBe(store)
    await expect(scoped.saveShape(jev)).rejects.toThrow('read-only')
  })

  it('resolves the owner\'s call with the owner shape and records the owner and digest', async () => {
    const store = await storeWithOwnerShapes()
    const call = await resolveProgramCall(ownerScopedShapeStore(store, 'owner@example.com'), { program: { name: 'jev', sha256: hash }, argv: ['ask'] })
    expect(call.detail.operation_id).toBe('ask')
    expect(call.executionContext).toMatchObject({ adapter_owner: 'owner@example.com', adapter_digest: 'SHA-256:owner-jev', version_tested: false })
  })

  it('keeps other accounts and registry programs on their previous resolution', async () => {
    const store = await storeWithOwnerShapes()
    const other = await resolveProgramCall(ownerScopedShapeStore(store, 'other@example.com'), { program: { name: 'jev', sha256: hash }, argv: ['ask'] })
    expect(other.detail.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(other.executionContext.adapter_owner).toBeUndefined()
    // The registry program hash stays with the registry shape even when an owner shape lists it.
    const git = await resolveProgramCall(ownerScopedShapeStore(store, 'owner@example.com'), { program: { name: 'gitwrap', sha256: 'c'.repeat(64) }, argv: ['status'] })
    expect(git.executionContext).toMatchObject({ adapter_digest: 'SHA-256:registry-git', version_tested: true })
    expect(git.executionContext.adapter_owner).toBeUndefined()
  })
})

describe('assertResourceChainTemplates', () => {
  it('accepts the matcher syntax and rejects a bare selector value', async () => {
    const { assertResourceChainTemplates } = await import('../src/shape-matcher.js')
    expect(() => assertResourceChainTemplates(['model', 'model:*', 'model:name=jev', 'repo:owner={repo|owner},name={repo|name}'])).not.toThrow()
    expect(() => assertResourceChainTemplates(['model:jev'])).toThrow('use key=value')
    expect(() => assertResourceChainTemplates(['{x}:a=b'])).toThrow('Invalid resource chain entry')
  })
})

describe('approveGrantWithExtension', () => {
  it('refuses to merge an owner-shape grant with a grant of another shape', async () => {
    const store = new InMemoryGrantStore()
    const base = { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always' as const, authorization_details: [{ type: 'openape_cli' as const, cli_id: 'jev', operation_id: 'ask', resource_chain: [], action: 'read', permission: 'jev[]#read', display: 'Ask', risk: 'low' as const }] }
    const context = { adapter_id: 'jev', adapter_version: 'server', resolved_executable: 'jev' }
    const old: OpenApeGrant = { id: 'old', status: 'approved', type: 'command', created_at: 1, request: { ...base, execution_context: { ...context, adapter_digest: 'SHA-256:registry' } } }
    const pending: OpenApeGrant = { id: 'new', status: 'pending', type: 'command', created_at: 2, request: { ...base, execution_context: { ...context, adapter_digest: 'SHA-256:owner', adapter_owner: 'owner@example.com' } } }
    await store.save(old); await store.save(pending)
    await expect(approveGrantWithExtension('new', 'owner@example.com', store, { extend_mode: 'merge', extend_grant_ids: ['old'] })).rejects.toThrow('same shape version')
    expect((await store.findById('old'))!.status).toBe('approved')
  })
})
