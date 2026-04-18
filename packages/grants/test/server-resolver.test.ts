import { describe, expect, it } from 'vitest'
import { createInMemoryShapeStore, type ServerShape } from '../src/shape-registry.js'
import { GENERIC_OPERATION_ID, resolveServerShape } from '../src/server-resolver.js'

const gitShape: ServerShape = {
  cli_id: 'git',
  executable: 'git',
  description: 'Git CLI',
  operations: [
    {
      id: 'git.clone',
      command: ['clone'],
      positionals: ['url'],
      display: 'Clone {url}',
      action: 'exec',
      risk: 'medium',
      resource_chain: ['repo:url={url}'],
    },
    {
      id: 'git.status',
      command: ['status'],
      positionals: [],
      display: 'Show git status',
      action: 'read',
      risk: 'low',
      resource_chain: [],
    },
  ],
  source: 'builtin',
  digest: 'sha256:deadbeef',
  createdAt: 0,
  updatedAt: 0,
}

describe('resolveServerShape', () => {
  it('matches a known operation by command prefix + positionals', async () => {
    const store = createInMemoryShapeStore([gitShape])
    const r = await resolveServerShape(store, 'git', ['git', 'clone', 'git@github.com:foo/bar.git'])
    expect(r.operation_id).toBe('git.clone')
    expect(r.synthetic).toBe(false)
    expect(r.detail.risk).toBe('medium')
    expect(r.detail.resource_chain).toEqual([
      { resource: 'repo', selector: { url: 'git@github.com:foo/bar.git' } },
    ])
    expect(r.detail.display).toBe('Clone git@github.com:foo/bar.git')
    expect(r.executable).toBe('git')
    expect(r.commandArgv).toEqual(['clone', 'git@github.com:foo/bar.git'])
    expect(r.permission.length).toBeGreaterThan(0)
  })

  it('matches a zero-positional operation', async () => {
    const store = createInMemoryShapeStore([gitShape])
    const r = await resolveServerShape(store, 'git', ['git', 'status'])
    expect(r.operation_id).toBe('git.status')
    expect(r.detail.risk).toBe('low')
    expect(r.synthetic).toBe(false)
  })

  it('falls back to _generic.exec for unknown CLI', async () => {
    const store = createInMemoryShapeStore()
    const r = await resolveServerShape(store, 'kubectl', ['kubectl', 'get', 'pods'])
    expect(r.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(r.detail.risk).toBe('high')
    expect(r.detail.constraints?.exact_command).toBe(true)
    expect(r.synthetic).toBe(true)
    expect(r.detail.resource_chain[0]).toEqual({ resource: 'cli', selector: { name: 'kubectl' } })
    expect(r.detail.resource_chain[1]!.resource).toBe('argv')
    expect(r.detail.resource_chain[1]!.selector?.hash).toMatch(/^SHA-256:[a-f0-9]{64}$/)
  })

  it('falls back to _generic.exec when argv does not match any operation', async () => {
    const store = createInMemoryShapeStore([gitShape])
    const r = await resolveServerShape(store, 'git', ['git', 'bizarre-subcommand'])
    expect(r.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(r.synthetic).toBe(true)
  })

  it('falls back to _generic.exec when shape has operations but none match argv length', async () => {
    const store = createInMemoryShapeStore([gitShape])
    // clone wants 1 positional, we give 0
    const r = await resolveServerShape(store, 'git', ['git', 'clone'])
    expect(r.operation_id).toBe(GENERIC_OPERATION_ID)
  })

  it('produces a stable argv_hash across runs for the same argv', async () => {
    const store = createInMemoryShapeStore()
    const a = await resolveServerShape(store, 'kubectl', ['kubectl', 'get', 'pods'])
    const b = await resolveServerShape(store, 'kubectl', ['kubectl', 'get', 'pods'])
    expect(a.executionContext.argv_hash).toBe(b.executionContext.argv_hash)
  })

  it('throws when fullArgv is empty', async () => {
    const store = createInMemoryShapeStore()
    await expect(resolveServerShape(store, 'kubectl', [])).rejects.toThrow(/must include the executable/)
  })
})
