import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseShellCommand } from '../src/shell-parser.js'
import { resolveCommand } from '../src/parser.js'
import type { LoadedAdapter } from '../src/types.js'

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

describe('resolveCommand executable normalization edge cases', () => {
  it('rejects argv starting with a relative path before normalization', async () => {
    const loaded = makeFooAdapter()
    await expect(
      resolveCommand(loaded, ['./foo', 'list']),
    ).rejects.toThrow(/expects executable foo, got \.\/foo/)
  })

  it('accepts a relative path from a shell string after basename normalization', async () => {
    const loaded = makeFooAdapter()

    const parsed = parseShellCommand('./foo list')
    expect(parsed).not.toBeNull()
    expect(parsed!.executable).toBe('./foo')

    const normalized = basename(parsed!.executable)
    expect(normalized).toBe('foo')

    const resolved = await resolveCommand(loaded, [normalized, ...parsed!.argv])
    expect(resolved.detail.cli_id).toBe('foo')
    expect(resolved.detail.operation_id).toBe('list')
  })
})
