import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
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
template = "Bearer \${value}"
value = "secret123"
`
    // Task 15 onward: the daemon stays running after parsing stdin, so we
    // wait for the banner instead of for `runCliWithEnv` exit. The banner
    // already includes the loaded-secret summary, which is what the original
    // assertion intends to cover.
    const handle = await spawnDaemonAndWaitForBanner(['--global', '--port', '0'], blob, { HOME: fakeHome })
    try {
      expect(handle.bannerStdout).toMatch(/secrets:\s*test_key/)
    }
    finally {
      await stopDaemon(handle)
    }
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
    // Task 15+: the daemon binds for real via `server.listen()`. With
    // `--port 0` the OS assigns a free port; the harness regex captures
    // whatever port number the banner reports.
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
      expect(handle.bannerStdout).toMatch(/listening on 127\.0\.0\.1:\d+/)
      expect(handle.port).toBeGreaterThan(0)
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

  it('binds to --port and emits OPENAPE_PROXY hint + bootstraps CA', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'bind-'))
    const apesDir = join(fakeHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      email: 'agent_bind@example.com',
      idp: 'https://id.example.com',
      bearer: 'tok',
    }))

    const handle = await spawnDaemonAndWaitForBanner(['--global', '--port', '0'], validToml, { HOME: fakeHome })
    try {
      expect(handle.bannerStdout).toMatch(/OPENAPE_PROXY=127\.0\.0\.1:\d+/)
      expect(handle.port).toBeGreaterThan(0)
      expect(existsSync(join(fakeHome, '.openape', 'proxy', 'ca.crt'))).toBe(true)
      expect(existsSync(join(fakeHome, '.openape', 'proxy', 'ca.key'))).toBe(true)
    }
    finally {
      await stopDaemon(handle)
    }
  }, 15000)

  it('daemon-mode does not require Proxy-Authorization on incoming requests', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'auth-bypass-'))
    const apesDir = join(fakeHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      email: 'agent_bypass@example.com',
      idp: 'https://id.example.com',
      bearer: 'tok',
    }))

    // Default action 'allow' for the agent means a request with no matching deny rule
    // will be allowed and forwarded. Without daemon-mode bypass the proxy would
    // 401 on the missing Proxy-Authorization header. With the bypass, it should
    // process the request — likely getting a 502 from the upstream resolution
    // failure (target host x.local doesn't exist), but NOT a 401.
    const handle = await spawnDaemonAndWaitForBanner(['--global', '--port', '0'], validToml, { HOME: fakeHome })
    try {
      const status = await new Promise<number>((resolveStatus) => {
        const req = httpRequest({
          host: '127.0.0.1',
          port: handle.port,
          method: 'GET',
          path: '/http://x.local/', // path-encoded form, no Proxy-Authorization header set
        }, res => resolveStatus(res.statusCode ?? 0))
        req.on('error', () => resolveStatus(0))
        req.end()
      })
      expect(status).not.toBe(401)
    }
    finally {
      await stopDaemon(handle)
    }
  }, 15000)
})
