import { describe, expect, it } from 'vitest'
import {
  GENERIC_OPERATION_ID,
  buildGenericAdapter,
  buildGenericResolved,
  isGenericResolved,
} from '../src/shapes/generic.js'

describe('buildGenericAdapter', () => {
  it('creates a synthetic adapter with the expected shape', () => {
    const loaded = buildGenericAdapter('kubectl')
    expect(loaded.synthetic).toBe(true)
    expect(loaded.adapter.cli.id).toBe('kubectl')
    expect(loaded.adapter.cli.executable).toBe('kubectl')
    expect(loaded.adapter.operations).toEqual([])
    expect(loaded.source).toBe('<synthetic>')
  })
})

describe('buildGenericResolved', () => {
  it('produces a ResolvedCommand for an unshaped CLI with full argv', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])

    expect(resolved.detail.type).toBe('openape_cli')
    expect(resolved.detail.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(resolved.detail.cli_id).toBe('kubectl')
    expect(resolved.detail.risk).toBe('high')
    expect(resolved.detail.constraints?.exact_command).toBe(true)
    expect(resolved.detail.action).toBe('exec')
    expect(resolved.detail.display).toBe('Execute (unshaped): `kubectl get pods`')
  })

  it('includes cli:name and argv:hash in the resource chain', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])

    expect(resolved.detail.resource_chain).toHaveLength(2)
    expect(resolved.detail.resource_chain[0]).toEqual({
      resource: 'cli',
      selector: { name: 'kubectl' },
    })
    expect(resolved.detail.resource_chain[1]!.resource).toBe('argv')
    expect(resolved.detail.resource_chain[1]!.selector?.hash).toMatch(/^SHA-256:[a-f0-9]{64}$/)
  })

  it('puts argv_hash in executionContext matching the resource_chain', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])

    const chainHash = resolved.detail.resource_chain[1]!.selector!.hash
    expect(resolved.executionContext.argv_hash).toBe(chainHash)
    expect(resolved.executionContext.argv).toEqual(['kubectl', 'get', 'pods'])
  })

  it('produces a stable argv_hash for identical inputs', async () => {
    const a = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    const b = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    expect(a.executionContext.argv_hash).toBe(b.executionContext.argv_hash)
  })

  it('produces different argv_hash for different argv', async () => {
    const a = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    const b = await buildGenericResolved('kubectl', ['kubectl', 'get', 'nodes'])
    expect(a.executionContext.argv_hash).not.toBe(b.executionContext.argv_hash)
  })

  it('populates executable and commandArgv from the argv', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods', '-n', 'default'])
    expect(resolved.executable).toBe('kubectl')
    expect(resolved.commandArgv).toEqual(['get', 'pods', '-n', 'default'])
  })

  it('computes a non-empty permission string', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    expect(resolved.permission.length).toBeGreaterThan(0)
    expect(resolved.detail.permission).toBe(resolved.permission)
  })

  it('throws when argv is empty', async () => {
    await expect(buildGenericResolved('kubectl', [])).rejects.toThrow(/must include the executable/)
  })

  it('marks the wrapping adapter as synthetic', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'version'])
    // Adapter comes from buildGenericAdapter — the synthetic flag lives on
    // LoadedAdapter, but the ResolvedCommand only carries the ShapesAdapter.
    // Verify via the adapter id/version sentinel.
    expect(resolved.adapter.cli.version).toBe('synthetic')
    expect(resolved.adapter.operations).toEqual([])
  })
})

describe('isGenericResolved', () => {
  it('returns true for a synthetic resolved command', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    expect(isGenericResolved(resolved)).toBe(true)
  })

  it('returns false for a non-generic resolved command', async () => {
    const resolved = await buildGenericResolved('kubectl', ['kubectl', 'get', 'pods'])
    const mutated = {
      ...resolved,
      detail: { ...resolved.detail, operation_id: 'list-pods' },
    }
    expect(isGenericResolved(mutated)).toBe(false)
  })
})
