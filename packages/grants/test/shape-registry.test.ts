import { describe, expect, it } from 'vitest'
import { createInMemoryShapeStore  } from '../src/shape-registry.js'
import type { ServerShape } from '../src/shape-registry.js'

function makeShape(cliId: string, extras: Partial<ServerShape> = {}): ServerShape {
  return {
    cli_id: cliId,
    executable: cliId,
    description: `${cliId} CLI`,
    operations: [{
      id: `${cliId}.default`,
      command: [],
      display: `Run ${cliId}`,
      action: 'exec',
      risk: 'medium',
      resource_chain: [],
    }],
    source: 'builtin',
    digest: `sha256:${cliId}`,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...extras,
  }
}

describe('createInMemoryShapeStore', () => {
  it('returns an empty list when seeded with nothing', async () => {
    const store = createInMemoryShapeStore()
    expect(await store.listShapes()).toEqual([])
  })

  it('returns seeded shapes sorted by cli_id', async () => {
    const store = createInMemoryShapeStore([makeShape('zsh'), makeShape('alpha'), makeShape('mid')])
    const list = await store.listShapes()
    expect(list.map(s => s.cli_id)).toEqual(['alpha', 'mid', 'zsh'])
  })

  it('getShape returns the stored shape or null', async () => {
    const store = createInMemoryShapeStore([makeShape('git')])
    expect((await store.getShape('git'))?.cli_id).toBe('git')
    expect(await store.getShape('nope')).toBeNull()
  })

  it('saveShape upserts', async () => {
    const store = createInMemoryShapeStore()
    await store.saveShape(makeShape('git', { description: 'initial' }))
    await store.saveShape(makeShape('git', { description: 'updated' }))
    expect((await store.getShape('git'))?.description).toBe('updated')
  })

  it('deleteShape removes the shape', async () => {
    const store = createInMemoryShapeStore([makeShape('git')])
    await store.deleteShape('git')
    expect(await store.getShape('git')).toBeNull()
    expect(await store.listShapes()).toEqual([])
  })

  it('deleteShape is a no-op for unknown cli_id', async () => {
    const store = createInMemoryShapeStore([makeShape('git')])
    await store.deleteShape('nope')
    expect((await store.listShapes()).length).toBe(1)
  })
})
