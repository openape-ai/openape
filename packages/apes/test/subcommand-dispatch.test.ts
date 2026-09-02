import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { dispatchExternalSubcommand } from '../src/subcommand-dispatch'

// These tests exist because PATH is the plugin registry: if dispatch stops
// finding `apes-<sub>`, every external subcommand silently degrades into an
// "unknown command" usage dump instead of running.
describe('external subcommand dispatch', () => {
  let binDir: string
  let originalPath: string | undefined

  function installFakeSubcommand(name: string, script: string): void {
    const file = path.join(binDir, name)
    writeFileSync(file, script, { mode: 0o755 })
  }

  beforeEach(() => {
    binDir = mkdtempSync(path.join(tmpdir(), 'apes-dispatch-'))
    originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(binDir, { recursive: true, force: true })
  })

  it('returns null when no matching executable is on PATH', () => {
    expect(dispatchExternalSubcommand(['definitely-not-installed'])).toBeNull()
  })

  it('runs apes-<sub> from PATH and returns its exit code', () => {
    installFakeSubcommand('apes-demo', '#!/bin/sh\nexit 0\n')
    expect(dispatchExternalSubcommand(['demo'])).toBe(0)
  })

  it('propagates a failing exit code', () => {
    installFakeSubcommand('apes-failing', '#!/bin/sh\nexit 7\n')
    expect(dispatchExternalSubcommand(['failing'])).toBe(7)
  })

  it('forwards the remaining arguments to the child', () => {
    const marker = path.join(binDir, 'args.txt')
    installFakeSubcommand('apes-args', `#!/bin/sh\nprintf '%s' "$*" > ${marker}\n`)
    expect(dispatchExternalSubcommand(['args', 'add', '--agent', 'iurio'])).toBe(0)
    expect(readFileSync(marker, 'utf8')).toBe('add --agent iurio')
  })

  it('refuses names that could escape PATH lookup', () => {
    expect(dispatchExternalSubcommand(['../evil'])).toBeNull()
    expect(dispatchExternalSubcommand(['/bin/sh'])).toBeNull()
    expect(dispatchExternalSubcommand(['--flag'])).toBeNull()
  })
})
