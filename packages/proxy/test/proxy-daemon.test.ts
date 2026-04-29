import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCliWithEnv as runCli, runCliWithEnv, spawnDaemonAndWaitForBanner, stopDaemon } from './_helpers/daemon-harness.js'

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
    const fakeHome = mkdtempSync(join(tmpdir(), 'accept-global-'))
    const apesDir = join(fakeHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      email: 'caller@example.com',
      idp: 'https://id.example.com',
      bearer: 'tok_caller',
    }))
    const blob = `version = "1"

[secrets.test_key]
target = "api.example.com"
header = "Authorization"
template = "Bearer {{value}}"
value = "secret123"
`
    const r = await runCliWithEnv(['--global', '--port', '0'], blob, { HOME: fakeHome })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/loaded 1 secrets.*test_key/)
  }, 15000)
})

describe('daemon harness — smoke', () => {
  it('runCliWithEnv passes a custom HOME', async () => {
    // Use a HOME without auth.json — Task 14 makes the daemon refuse cleanly,
    // proving the env override actually plumbed through to homedir().
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-no-auth-'))
    const r = await runCliWithEnv(['--global', '--port', '0'], 'version = "1"\n', { HOME: fakeHome })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/auth\.json|apes login/i)
  }, 15000)

  it('spawnDaemonAndWaitForBanner detects the banner', async () => {
    // Task 14 prints a stub `listening on 127.0.0.1:<port>` line before exiting
    // (Task 15 replaces this with the real server.listen() callback). The
    // harness should resolve as soon as the banner appears even if the daemon
    // exits cleanly right after.
    const fakeHome = mkdtempSync(join(tmpdir(), 'harness-banner-'))
    const apesDir = join(fakeHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      email: 'smoke@example.com',
      idp: 'https://id.example.com',
      bearer: 'tok_smoke',
    }))
    const handle = await spawnDaemonAndWaitForBanner(
      ['--global', '--port', '0'],
      'version = "1"\n',
      { HOME: fakeHome },
    )
    try {
      expect(handle.bannerStdout).toMatch(/listening on 127\.0\.0\.1:0/)
    }
    finally {
      await stopDaemon(handle)
    }
  }, 15000)
})

describe('daemon identity loading', () => {
  const validToml = `version = "1"\n[secrets.x]\ntarget="x.local/*"\nheader="A"\ntemplate="\${value}"\nvalue="v"\n`

  it('refuses --global with missing auth.json', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'no-auth-'))
    // Note: no ~/.config/apes/auth.json created.
    const r = await runCliWithEnv(['--global', '--port', '0'], validToml, { HOME: fakeHome })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/auth\.json|apes login/i)
  }, 15000)

  it('loads identity from auth.json and prints it in the banner', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'with-auth-'))
    const apesDir = join(fakeHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      email: 'agent_iurio@example.com',
      idp: 'https://id.example.com',
      bearer: 'tok_abc',
    }))
    const handle = await spawnDaemonAndWaitForBanner(['--global', '--port', '0'], validToml, { HOME: fakeHome })
    try {
      expect(handle.bannerStdout).toMatch(/agent_iurio@example\.com/)
      expect(handle.bannerStdout).toMatch(/https:\/\/id\.example\.com/)
    }
    finally {
      await stopDaemon(handle)
    }
  }, 15000)
})
