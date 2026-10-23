// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { superviseProcess } from '../../src/worker/runtime/sandbox'

// The guardian logic is tested with a synthetic helper on any host; the kernel decision is selected per test.
const kernel = vi.hoisted(() => ({ release: '25.6.0' }))
vi.mock('../../src/main/support', async (original) => {
  const actual = await original<typeof import('../../src/main/support')>()
  return { ...actual, assertExecutionSupported: () => actual.assertExecutionSupported(actual.executionSupport('darwin', 'arm64', kernel.release)) }
})

let root: string | undefined
afterEach(() => { kernel.release = '25.6.0'; if (root) rmSync(root, { recursive: true, force: true }); root = undefined })

it('seals a stored domain when its registration callback fails afterwards', async () => {
  root = mkdtempSync(join(tmpdir(), 'pods-domain-'))
  const helper = join(root, 'helper.sh')
  // Mirrors the native guardian: it writes the record first and closes it without fork when the lease is already closed.
  writeFileSync(helper, '#!/bin/sh\nlease=$(cat)\n[ "$1" = supervise-record ] && [ -z "$lease" ] && printf closed > "$2" && exit 125\nexit 1\n')
  chmodSync(helper, 0o755)
  let registered = ''
  const aborted = superviseProcess(helper, '/usr/bin/true', [], root, {}, root, async (path) => {
    registered = path
    throw new Error('This operation was aborted')
  })

  await expect(aborted).rejects.toThrow('This operation was aborted')
  expect(registered).toMatch(/domain-[a-f0-9-]{36}\.record$/)
  expect(readFileSync(registered, 'utf8')).toBe('closed')
})

it('refuses an unverified kernel before the helper registers or starts anything', async () => {
  root = mkdtempSync(join(tmpdir(), 'pods-domain-'))
  const helper = join(root, 'helper.sh'); const started = join(root, 'started')
  writeFileSync(helper, `#!/bin/sh\ntouch ${JSON.stringify(started)}\nexit 0\n`); chmodSync(helper, 0o755)
  kernel.release = '99.0.0'
  let registered = false
  await expect(superviseProcess(helper, '/usr/bin/true', [], root, {}, root, () => { registered = true })).rejects.toThrow('Pod execution is blocked on darwin 99.0.0 (arm64)')
  expect(registered).toBe(false)
  expect(existsSync(started)).toBe(false)
})
