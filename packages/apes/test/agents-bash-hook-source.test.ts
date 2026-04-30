import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASH_VIA_APE_SHELL_HOOK_SOURCE } from '../src/lib/agent-bootstrap'

// Drift check: the inlined hook source in agent-bootstrap.ts must stay
// byte-identical to scripts/bash-via-ape-shell.sh. We embed at build time
// (rather than fs-resolve at runtime) because the script lives at different
// relative paths in dev vs. installed layouts; this test guards the inline.
describe('bundled bash-via-ape-shell hook source', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const scriptPath = resolve(here, '../scripts/bash-via-ape-shell.sh')

  it('matches the on-disk script byte-for-byte', () => {
    const onDisk = readFileSync(scriptPath, 'utf-8')
    expect(BASH_VIA_APE_SHELL_HOOK_SOURCE).toBe(onDisk)
  })

  it('starts with a bash shebang', () => {
    expect(BASH_VIA_APE_SHELL_HOOK_SOURCE.startsWith('#!/bin/bash\n')).toBe(true)
  })
})
