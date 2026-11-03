import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerShape } from '@openape/grants'
import { expect, it, vi } from 'vitest'

// Owner-published shapes (issue 1551) persist per owner beside the registry table.
it('stores, replaces and removes owner shapes per owner without touching registry shapes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'idp-owner-shapes-'))
  const url = `file:${join(directory, 'idp.sqlite')}`
  const client = createClient({ url })
  const database = drizzle(client)
  vi.doMock('../server/database/drizzle', () => ({ useDb: () => database }))
  vi.doMock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ tursoUrl: url }) }))
  vi.stubEnv('OPENAPE_E2E', '0')
  vi.stubGlobal('defineNitroPlugin', (initialize: () => Promise<void>) => initialize())
  try {
    await (await import('../server/plugins/02.database')).default
    const { createDrizzleShapeStore } = await import('../server/utils/drizzle-shape-store')
    const store = createDrizzleShapeStore()
    const jev: ServerShape = { cli_id: 'jev', executable: 'jev', description: '', operations: [{ id: 'ask', command: ['ask'], display: 'Ask', action: 'read', risk: 'low', resource_chain: [] }], source: 'custom', digest: 'SHA-256:v1', toml: 'toml v1', createdAt: 1, updatedAt: 1 }
    await store.saveShape({ ...jev, cli_id: 'git', executable: 'git', source: 'builtin', toml: undefined })
    await store.saveOwnerShape!('a@example.test', jev)
    await store.saveOwnerShape!('b@example.test', { ...jev, digest: 'SHA-256:b' })
    await store.saveOwnerShape!('a@example.test', { ...jev, digest: 'SHA-256:v2', toml: 'toml v2', updatedAt: 5 })
    expect(await store.listOwnerShapes!('a@example.test')).toEqual([{ ...jev, owner: 'a@example.test', digest: 'SHA-256:v2', toml: 'toml v2', updatedAt: 5 }])
    expect((await store.listOwnerShapes!('b@example.test'))[0]?.digest).toBe('SHA-256:b')
    expect((await store.listShapes()).map(shape => shape.cli_id)).toEqual(['git'])
    expect(await store.deleteOwnerShape!('a@example.test', 'jev')).toBe(true)
    expect(await store.deleteOwnerShape!('a@example.test', 'jev')).toBe(false)
    expect(await store.listOwnerShapes!('a@example.test')).toEqual([])
    expect(await store.listOwnerShapes!('b@example.test')).toHaveLength(1)
  }
  finally {
    client.close()
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('../server/database/drizzle'); vi.doUnmock('nitropack/runtime'); vi.resetModules()
    rmSync(directory, { recursive: true, force: true })
  }
})

// Domain shapes and the shape audit (issue 1553): one transaction per import, per-domain rows.
it('stores domain shapes per domain and writes an import with its audit all or nothing', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'idp-domain-shapes-'))
  const url = `file:${join(directory, 'idp.sqlite')}`
  const client = createClient({ url })
  const database = drizzle(client)
  vi.doMock('../server/database/drizzle', () => ({ useDb: () => database }))
  vi.doMock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ tursoUrl: url }) }))
  vi.stubEnv('OPENAPE_E2E', '0')
  vi.stubGlobal('defineNitroPlugin', (initialize: () => Promise<void>) => initialize())
  try {
    await (await import('../server/plugins/02.database')).default
    const { createDrizzleShapeStore } = await import('../server/utils/drizzle-shape-store')
    const store = createDrizzleShapeStore()
    const jev: ServerShape = { cli_id: 'jev', executable: 'jev', description: 'Jev', operations: [{ id: 'ask', command: ['ask'], display: 'Ask', action: 'read', risk: 'low', resource_chain: [] }], source: 'custom', digest: 'SHA-256:v1', toml: 'toml v1', published_by: 'admin@a.test', createdAt: 1, updatedAt: 1 }
    const change = { scope: 'domain' as const, scope_key: 'a.test', action: 'add' as const, cli_id: 'jev', previous_digest: null, digest: 'SHA-256:v1', previous_toml: null, toml: 'toml v1', source: { commit: 'abc1234' }, actor: 'admin@a.test', created_at: 1 }
    await store.applyShapeChanges!({ scope: 'domain', scope_key: 'a.test', save: [jev], remove: [], changes: [change] })
    await store.saveDomainShape!('b.test', { ...jev, digest: 'SHA-256:b' })
    expect(await store.listDomainShapes!('a.test')).toEqual([{ ...jev, domain: 'a.test' }])
    expect((await store.listDomainShapes!('b.test'))[0]?.digest).toBe('SHA-256:b')
    expect(await store.listShapeChanges!('domain', 'a.test', 10)).toEqual([change])
    expect(await store.listShapeChanges!('domain', 'b.test', 10)).toEqual([])

    // A failing audit entry rolls back the whole batch, including its removals.
    await expect(store.applyShapeChanges!({ scope: 'domain', scope_key: 'a.test', save: [{ ...jev, cli_id: 'tool', executable: 'tool' }], remove: ['jev'], changes: [{ ...change, actor: null as never }] })).rejects.toThrow()
    expect((await store.listDomainShapes!('a.test')).map(shape => shape.cli_id)).toEqual(['jev'])
    expect(await store.listShapeChanges!('domain', 'a.test', 10)).toHaveLength(1)

    await store.applyShapeChanges!({ scope: 'instance', scope_key: '', save: [{ ...jev, source: 'builtin', toml: undefined, published_by: undefined, virtual: true }], remove: [], changes: [{ ...change, scope: 'instance', scope_key: '' }] })
    expect(await store.getShape('jev')).toMatchObject({ source: 'builtin', virtual: true })
    expect(await store.deleteDomainShape!('a.test', 'jev')).toBe(true)
    expect(await store.deleteDomainShape!('a.test', 'jev')).toBe(false)
    expect(await store.listDomainShapes!('b.test')).toHaveLength(1)
  }
  finally {
    client.close()
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('../server/database/drizzle'); vi.doUnmock('nitropack/runtime'); vi.resetModules()
    rmSync(directory, { recursive: true, force: true })
  }
})
