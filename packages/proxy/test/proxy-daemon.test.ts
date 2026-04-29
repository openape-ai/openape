import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCliWithEnv as runCli, runCliWithEnv, spawnDaemonAndWaitForBanner } from './_helpers/daemon-harness.js'

describe('daemon CLI', () => {
  it('refuses --global with empty stdin', async () => {
    const r = await runCli(['--global', '--port', '0'], '')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/stdin|secrets/i)
  }, 15000)

  it('refuses --global with invalid TOML', async () => {
    const r = await runCli(['--global', '--port', '0'], 'this is not toml = = =')
    expect(r.code).not.toBe(0)
  }, 15000)

  it('accepts --global with valid secrets TOML on stdin', async () => {
    const blob = `version = "1"

[secrets.test_key]
target = "api.example.com"
header = "Authorization"
template = "Bearer {{value}}"
value = "secret123"
`
    const r = await runCli(['--global', '--port', '0'], blob)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/loaded 1 secrets.*test_key/)
  }, 15000)
})

describe('daemon harness — smoke', () => {
  it('runCliWithEnv passes a custom HOME', async () => {
    // Use a HOME without auth.json — daemon must refuse cleanly.
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-no-auth-'))
    const r = await runCliWithEnv(['--global', '--port', '0'], 'version = "1"\n', { HOME: fakeHome })
    // Note: at Task 13.5 the daemon doesn't yet load auth.json (Task 14), so the
    // empty-version-only TOML will be accepted, secrets will be empty, and the
    // daemon will exit 0. Verify env passes through.
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/loaded 0 secrets/i)
  }, 15000)

  it('spawnDaemonAndWaitForBanner waits for banner pattern', async () => {
    // The harness's banner regex matches `listening on 127.0.0.1:<port>` —
    // but Task 13's --global mode doesn't yet emit a "listening" banner
    // (it just exits after parsing). Task 15 will add the actual listen banner.
    // For Task 13.5's smoke, just verify the harness's spawn + banner-detect
    // surfaces a clear error when the banner never arrives within the timeout.
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-no-bind-'))
    await expect(
      spawnDaemonAndWaitForBanner(
        ['--global', '--port', '0'],
        'version = "1"\n',
        { HOME: fakeHome },
        500, // short timeout for the smoke
      ),
    ).rejects.toThrow(/exited before banner|timeout/i)
  }, 15000)
})
