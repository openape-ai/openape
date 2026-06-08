import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runApeShell } from '../src/agent-tools/ape-shell-exec'

describe('runApeShell (bypass mode)', () => {
  let savedBypass: string | undefined
  let tmpDir: string

  beforeEach(() => {
    savedBypass = process.env.OPENAPE_BYPASS_APE_SHELL
    process.env.OPENAPE_BYPASS_APE_SHELL = '1'
    tmpDir = mkdtempSync(`${tmpdir()}/`)
  })

  afterEach(() => {
    if (savedBypass === undefined) {
      delete process.env.OPENAPE_BYPASS_APE_SHELL
    }
    else {
      process.env.OPENAPE_BYPASS_APE_SHELL = savedBypass
    }
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs pwd in the given cwd and returns the real path', async () => {
    // macOS tmpdir is often a symlink (/var → /private/var), so compare
    // against the resolved physical path
    const realTmpDir = realpathSync(tmpDir)
    const result = await runApeShell('pwd -P', 5000, tmpDir)

    expect(result.exit_code).toBe(0)
    expect(result.stdout.trim()).toBe(realTmpDir)
  })

  it('works without cwd (backward-compatible)', async () => {
    const result = await runApeShell('echo ok', 5000)
    expect(result.exit_code).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })
})
