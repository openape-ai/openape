import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseShellCommand } from '../src/shapes/shell-parser.js'
import { resolveCommand } from '../src/shapes/parser.js'
import type { LoadedAdapter } from '../src/shapes/types.js'

// Minimal hand-rolled adapter that matches `foo list [--flag value]*`.
// Only the fields `resolveCommand` actually reads are populated.
function makeFooAdapter(): LoadedAdapter {
  return {
    source: '/tmp/test/foo.toml',
    digest: 'sha256:test',
    adapter: {
      schema: 'openape-shapes/v1',
      cli: {
        id: 'foo',
        executable: 'foo',
        audience: 'shapes',
      },
      operations: [
        {
          id: 'list',
          command: ['list'],
          display: 'foo list',
          resource_chain: [],
          action: 'list',
          risk: 'low',
        },
      ],
    },
  } as unknown as LoadedAdapter
}

describe('resolveCommand invariant: strict executable comparison', () => {
  it('accepts argv with the bare binary name', async () => {
    const loaded = makeFooAdapter()
    const resolved = await resolveCommand(loaded, ['foo', 'list'])
    expect(resolved.detail.cli_id).toBe('foo')
  })

  it('rejects argv starting with an absolute path — callers must normalize', async () => {
    const loaded = makeFooAdapter()
    await expect(
      resolveCommand(loaded, ['/usr/local/bin/foo', 'list']),
    ).rejects.toThrow(/expects executable foo, got \/usr\/local\/bin\/foo/)
  })
})

describe('shell routing: parseShellCommand + basename normalization', () => {
  it('normalizes an absolute path from a bash -c string so resolveCommand accepts it', async () => {
    const loaded = makeFooAdapter()

    // Replays the exact pattern from tryAdapterModeFromShell in run.ts
    const parsed = parseShellCommand('/usr/local/bin/foo list')
    expect(parsed).not.toBeNull()
    expect(parsed!.executable).toBe('/usr/local/bin/foo')

    const normalized = basename(parsed!.executable)
    expect(normalized).toBe('foo')

    const resolved = await resolveCommand(loaded, [normalized, ...parsed!.argv])
    expect(resolved.detail.cli_id).toBe('foo')
    expect(resolved.detail.operation_id).toBe('list')
  })
})
