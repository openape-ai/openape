// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { superviseProcess } from '../../src/worker/runtime/sandbox'

let root: string | undefined
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined })

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
