// Shape tiers (issues 1551, 1553): personal shapes resolve one owner's calls
// before their email domain's shapes, which come before the IdP-wide shapes;
// an overridden shape drops out with its tested digests.
import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { approveGrantWithExtension } from '../src/grants.js'
import { InMemoryGrantStore } from '../src/stores.js'
import { resolveProgramCall } from '../src/program-authorization.js'
import { GENERIC_OPERATION_ID } from '../src/server-resolver.js'
import type { ServerShape } from '../src/shape-registry.js'
import { createInMemoryShapeStore, emailDomain, sameShapeTier, scopedShapeStore, shapeScopeOf } from '../src/shape-registry.js'

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
const podRuntime: ServerShape = { ...registryGit, cli_id: 'pod-runtime', executable: 'pod-runtime', digest: 'SHA-256:pod-runtime', tested_digests: undefined, virtual: true }
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
const owner = 'owner@example.com'
const scope = shapeScopeOf(owner)

async function storeWithTiers() {
  const store = createInMemoryShapeStore([registryGit, podRuntime])
  await store.saveOwnerShape!(owner, jev)
  // A personal shape listing a registry program hash claims no tested version.
  await store.saveOwnerShape!(owner, { ...jev, cli_id: 'gitwrap', executable: 'gitwrap', tested_digests: registryGit.tested_digests })
  await store.saveDomainShape!('example.com', { ...jev, digest: 'SHA-256:domain-jev' })
  await store.saveDomainShape!('example.com', { ...jev, cli_id: 'git-domain', executable: 'git', operations: registryGit.operations, digest: 'SHA-256:domain-git' })
  return store
}

describe('scopedShapeStore', () => {
  it('derives the scope from the owner\'s email domain', () => {
    expect(shapeScopeOf('Owner@Example.COM')).toEqual({ owner: 'Owner@Example.COM', domain: 'example.com' })
    expect(shapeScopeOf(undefined)).toEqual({})
    expect(emailDomain('no-domain@')).toBeUndefined()
  })

  it('reads personal before domain before IdP-wide shapes, never across scopes', async () => {
    const store = await storeWithTiers()
    const scoped = scopedShapeStore(store, scope)
    expect((await scoped.listShapes()).map(shape => `${shape.owner ?? shape.domain ?? 'instance'}:${shape.cli_id}`))
      .toEqual([`${owner}:gitwrap`, `${owner}:jev`, 'example.com:git-domain', 'instance:pod-runtime'])
    expect((await scoped.getShape('jev'))?.digest).toBe('SHA-256:owner-jev')
    // The domain shape for the git executable overrides the IdP-wide git shape for this domain.
    expect(await scoped.getShape('git')).toBeNull()
    expect((await scoped.getShape('gitwrap'))?.tested_digests).toBeUndefined()
    // Another account of the same domain reads the domain shapes, not the owner's personal ones.
    const colleague = scopedShapeStore(store, shapeScopeOf('colleague@example.com'))
    expect((await colleague.getShape('jev'))?.digest).toBe('SHA-256:domain-jev')
    // Another domain reads only IdP-wide shapes.
    const foreign = scopedShapeStore(store, shapeScopeOf('someone@other.test'))
    expect((await foreign.getShape('jev'))).toBeNull()
    expect((await foreign.getShape('git'))?.digest).toBe('SHA-256:registry-git')
    expect(scopedShapeStore(store, {})).toBe(store)
    await expect(scoped.saveShape(jev)).rejects.toThrow('read-only')
  })

  it('lets a personal shape take an IdP-wide name and drops the overridden tested digests', async () => {
    const store = createInMemoryShapeStore([registryGit])
    await store.saveOwnerShape!(owner, { ...jev, cli_id: 'git', executable: 'git', operations: registryGit.operations, digest: 'SHA-256:owner-git' })
    const call = await resolveProgramCall(scopedShapeStore(store, scope), { program: { name: 'git', sha256: 'c'.repeat(64) }, argv: ['status'] })
    expect(call.executionContext).toMatchObject({ adapter_owner: owner, adapter_digest: 'SHA-256:owner-git', version_tested: false })
    expect(call.executionContext.adapter_domain).toBeUndefined()
    // Without the override the registry's tested digest selects it again.
    const registry = await resolveProgramCall(scopedShapeStore(store, shapeScopeOf('other@example.com')), { program: { name: 'git', sha256: 'c'.repeat(64) }, argv: ['status'] })
    expect(registry.executionContext).toMatchObject({ adapter_digest: 'SHA-256:registry-git', version_tested: true })
    expect(registry.executionContext.adapter_owner).toBeUndefined()
  })

  it('records the domain of a domain-shape call', async () => {
    const store = await storeWithTiers()
    const call = await resolveProgramCall(scopedShapeStore(store, shapeScopeOf('colleague@example.com')), { program: { name: 'git', sha256: 'c'.repeat(64) }, argv: ['status'] })
    expect(call.executionContext).toMatchObject({ adapter_domain: 'example.com', adapter_digest: 'SHA-256:domain-git', adapter_id: 'git-domain', version_tested: false })
    expect(call.executionContext.adapter_owner).toBeUndefined()
  })

  it('never lets a personal or domain shape replace an operation of the Pods desktop', async () => {
    const store = createInMemoryShapeStore([podRuntime])
    await store.saveOwnerShape!(owner, { ...jev, cli_id: 'pod-runtime', executable: 'pod-runtime' })
    await store.saveDomainShape!('example.com', { ...jev, cli_id: 'pod-http', executable: 'pod-runtime' })
    expect((await scopedShapeStore(store, scope).listShapes()).map(shape => shape.cli_id)).toEqual(['pod-runtime'])
    await expect(resolveProgramCall(scopedShapeStore(store, scope), { program: { name: 'pod-runtime', sha256: hash }, argv: ['run'] })).rejects.toThrow('Pods desktop')
  })

  it('keeps other accounts and non-overridden registry programs on their previous resolution', async () => {
    const store = await storeWithTiers()
    const other = await resolveProgramCall(scopedShapeStore(store, shapeScopeOf('other@other.test')), { program: { name: 'jev', sha256: hash }, argv: ['ask'] })
    expect(other.detail.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(other.executionContext.adapter_owner).toBeUndefined()
    // A tested digest of a shape no upper tier overrides still selects that shape, whatever the program is called.
    const plain = createInMemoryShapeStore([registryGit])
    await plain.saveOwnerShape!(owner, { ...jev, cli_id: 'gitwrap', executable: 'gitwrap' })
    const git = await resolveProgramCall(scopedShapeStore(plain, scope), { program: { name: 'gitwrap', sha256: 'c'.repeat(64) }, argv: ['status'] })
    expect(git.executionContext).toMatchObject({ adapter_digest: 'SHA-256:registry-git', version_tested: true })
    expect(git.executionContext.adapter_owner).toBeUndefined()
  })
})

describe('sameShapeTier', () => {
  const personal = { adapter_owner: owner, adapter_digest: 'SHA-256:v1' }
  const domain = { adapter_domain: 'example.com', adapter_digest: 'SHA-256:v1' }
  it('binds personal and domain grants to tier and digest, never IdP-wide ones', () => {
    expect(sameShapeTier({ adapter_digest: 'SHA-256:old' }, { adapter_digest: 'SHA-256:new' })).toBe(true)
    expect(sameShapeTier(personal, { ...personal })).toBe(true)
    expect(sameShapeTier(domain, { ...domain })).toBe(true)
    expect(sameShapeTier(personal, { adapter_digest: 'SHA-256:v1' })).toBe(false)
    expect(sameShapeTier(domain, { adapter_digest: 'SHA-256:v1' })).toBe(false)
    expect(sameShapeTier({ adapter_digest: 'SHA-256:v1' }, domain)).toBe(false)
    expect(sameShapeTier(personal, domain)).toBe(false)
    expect(sameShapeTier(domain, { ...domain, adapter_digest: 'SHA-256:v2' })).toBe(false)
    expect(sameShapeTier(domain, { ...domain, adapter_domain: 'other.test' })).toBe(false)
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

  it('refuses to merge a domain-shape grant with a registry or personal grant of the same digest', async () => {
    const store = new InMemoryGrantStore()
    const base = { requester: 'agent@example.com', target_host: 'macmini', audience: 'shapes', grant_type: 'always' as const, authorization_details: [{ type: 'openape_cli' as const, cli_id: 'jev', operation_id: 'ask', resource_chain: [], action: 'read', permission: 'jev[]#read', display: 'Ask', risk: 'low' as const }] }
    const context = { adapter_id: 'jev', adapter_version: 'server', resolved_executable: 'jev', adapter_digest: 'SHA-256:same' }
    await store.save({ id: 'registry', status: 'approved', type: 'command', created_at: 1, request: { ...base, execution_context: context } })
    await store.save({ id: 'personal', status: 'approved', type: 'command', created_at: 1, request: { ...base, execution_context: { ...context, adapter_owner: 'owner@example.com' } } })
    await store.save({ id: 'new', status: 'pending', type: 'command', created_at: 2, request: { ...base, execution_context: { ...context, adapter_domain: 'example.com' } } })
    await expect(approveGrantWithExtension('new', 'owner@example.com', store, { extend_mode: 'merge', extend_grant_ids: ['registry'] })).rejects.toThrow('same shape version')
    await expect(approveGrantWithExtension('new', 'owner@example.com', store, { extend_mode: 'merge', extend_grant_ids: ['personal'] })).rejects.toThrow('same shape version')
  })
})
