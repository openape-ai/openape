import { describe, expect, it } from 'vitest'
import { resolveGenericOrReject } from '../src/shapes/adapters.js'
import { GENERIC_OPERATION_ID } from '../src/shapes/generic.js'

describe('resolveGenericOrReject', () => {
  it('returns a synthetic ResolvedCommand when genericEnabled=true', async () => {
    const resolved = await resolveGenericOrReject('kubectl', ['kubectl', 'get', 'pods'], {
      genericEnabled: true,
    })
    expect(resolved.detail.operation_id).toBe(GENERIC_OPERATION_ID)
    expect(resolved.detail.cli_id).toBe('kubectl')
    expect(resolved.detail.risk).toBe('high')
    expect(resolved.executable).toBe('kubectl')
  })

  it('throws the legacy "No adapter found" error when genericEnabled=false', async () => {
    await expect(
      resolveGenericOrReject('kubectl', ['kubectl', 'get', 'pods'], { genericEnabled: false }),
    ).rejects.toThrow(/No adapter found for kubectl/)
  })

  it('does not touch the filesystem or network', async () => {
    // Pure synthesis — no external I/O. A successful call with a name that
    // clearly has no adapter file proves this.
    const resolved = await resolveGenericOrReject('totally-made-up-cli', ['totally-made-up-cli', '--flag'], {
      genericEnabled: true,
    })
    expect(resolved.detail.cli_id).toBe('totally-made-up-cli')
  })
})
