import type { KeyLike } from 'jose'
import type { RunningAppServer, RunningServer } from 'openape-e2e/lifecycle'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { makeTempDir, startAppServer, startServer } from 'openape-e2e/lifecycle'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// CLI roundtrip E2E: drives the REAL built `ape-testruns` binary (subprocess)
// against a locally booted testrun app — proving that CLI build, the
// @openape/cli-auth chain (auth.json → /api/cli/exchange → cached SP token)
// and the server API work together, not just in isolation.
//
// Auth chain under test, end to end:
//   1. An in-process fake IdP serves a JWKS (startAppServer).
//   2. auth.json in an isolated HOME carries an IdP token signed by that key
//      (iss = fake IdP, aud = 'apes-cli' — exactly what `apes login` stores).
//   3. The CLI exchanges it at the booted SP's /api/cli/exchange; the SP
//      resolves the subject's IdP via DDISA_MOCK_RECORDS (env mock in
//      @openape/core's resolver) and verifies against the fake JWKS —
//      OPENAPE_SP_ALLOW_INSECURE_IDP=1 lets the loopback issuer through the
//      SSRF guard.
//   4. The minted HS256 SP token authenticates the actual upload.

const SECRET = 'e2e-cli-roundtrip-secret-at-least-32-chars'
const CLIENT_ID = 'testrun.openape.ai'
const UPLOADER = 'uploader@e2e.test'
const IDP_KID = 'e2e-idp'
const CLI_TIMEOUT_MS = 60_000

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const monorepoRoot = resolve(appRoot, '..', '..')
const cliPath = join(monorepoRoot, 'packages', 'ape-testruns', 'dist', 'cli.mjs')

// 1x1 transparent PNG — enough to exercise the asset PUT with real bytes.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const manifest = {
  title: 'CLI roundtrip',
  project: 'openape',
  summary: 'Uploaded by the real ape-testruns binary.',
  tests: [
    {
      id: 't1',
      title: 'uploads through the real CLI',
      status: 'passed',
      steps: [{ title: 'landing', caption: 'Landing page', shot: 'step1.png' }],
    },
  ],
}

let idp: RunningAppServer
let server: RunningServer
let base = ''
let idpKey: KeyLike
let homeDir = ''
let runDir = ''

async function forgeIdpToken(key: KeyLike): Promise<string> {
  return await new SignJWT({ act: 'human', email: UPLOADER })
    .setProtectedHeader({ alg: 'ES256', kid: IDP_KID })
    .setSubject(UPLOADER)
    .setIssuer(idp.url)
    .setAudience('apes-cli')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)
}

// Isolated HOME with the auth.json layout @openape/cli-auth reads
// (~/.config/apes/auth.json, same shape `apes login` writes).
async function seedHome(key: KeyLike): Promise<string> {
  const home = makeTempDir('testrun-cli-home-')
  const configDir = join(home, '.config', 'apes')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'auth.json'), JSON.stringify({
    idp: idp.url,
    email: UPLOADER,
    access_token: await forgeIdpToken(key),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }, null, 2))
  return home
}

function makeRunDir(): string {
  const dir = makeTempDir('testrun-cli-run-')
  writeFileSync(join(dir, 'testrun.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'step1.png'), TINY_PNG)
  return dir
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

// Async on purpose: the fake IdP lives in THIS process, and the SP fetches
// its JWKS while the CLI call is in flight — a spawnSync here would block the
// event loop and deadlock that fetch into jose's 5s timeout (learned the hard
// way). Timeout + SIGKILL are the hang guard: a stuck CLI yields status null.
function runCli(args: string[], home: string): Promise<CliResult> {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [cliPath, ...args], {
      timeout: CLI_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        HOME: home,
        OPENAPE_CLI_AUTH_HOME: join(home, '.config', 'apes'),
        // No APE_TESTRUNS_ENDPOINT here on purpose: every invocation passes
        // `--endpoint`, and cli-auth routes the token exchange through that
        // per-request override too — this run proves the flag path end to end.
      },
    }, (err, stdout, stderr) => {
      const code = (err as { code?: unknown } | null)?.code
      const status = err ? (typeof code === 'number' ? code : null) : 0
      resolveResult({ status, stdout, stderr })
    })
  })
}

interface UploadJson {
  id: string
  slug: string
  url: string
  status: string
  version: number
  uploaded: number
  missing: string[]
}

function uploadJson(res: CliResult): UploadJson {
  expect(res.status, `CLI failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0)
  return JSON.parse(res.stdout) as UploadJson
}

beforeAll(() => {
  // Build the real CLI (plus its workspace deps) through turbo — warm caches
  // make this a no-op locally and cheap in CI.
  const build = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@openape/ape-testruns'], {
    cwd: monorepoRoot,
    encoding: 'utf-8',
    timeout: 240_000,
  })
  if (build.status !== 0 || !existsSync(cliPath)) {
    throw new Error(`Building @openape/ape-testruns failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`)
  }
}, 300_000)

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  idpKey = privateKey
  const jwk = { ...(await exportJWK(publicKey)), alg: 'ES256', use: 'sig', kid: IDP_KID }

  // Fake IdP: only needs to serve the JWKS the SP verifies subject tokens with.
  idp = await startAppServer((req, res) => {
    if (req.url?.startsWith('/.well-known/jwks.json')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    res.statusCode = 404
    res.end()
  })

  const db = join(makeTempDir('testrun-cli-e2e-'), 'e2e.db')
  server = await startServer({
    cwd: appRoot,
    readyPath: '/api/health',
    timeoutMs: 150_000,
    env: ({ url }) => ({
      NUXT_IGNORE_LOCK: '1',
      NUXT_TURSO_URL: `file:${db}`,
      NUXT_OPENAPE_SP_SESSION_SECRET: SECRET,
      NUXT_OPENAPE_SP_CLIENT_ID: CLIENT_ID,
      NUXT_PUBLIC_URL: url,
      // /api/cli/exchange resolves the subject's IdP via DDISA; point the
      // uploader's domain at the fake IdP and let its loopback/http URL
      // through the SSRF guard (dev hatch).
      DDISA_MOCK_RECORDS: JSON.stringify({ 'e2e.test': { idp: idp.url } }),
      OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
    }),
  })
  base = server.url

  homeDir = await seedHome(idpKey)
  runDir = makeRunDir()
}, 240_000)

afterAll(async () => {
  await server?.stop()
  await idp?.stop()
})

describe('ape-testruns CLI roundtrip (real binary against a booted server)', () => {
  it('uploads a run: exit 0, proof URL on stdout, run served by the public API', async () => {
    const res = await runCli(['upload', runDir, '--endpoint', base], homeDir)
    expect(res.status, `CLI failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0)

    // Agent contract: stdout carries only the proof link.
    const url = res.stdout.trim()
    expect(url).toMatch(/\/r\/[\w-]+$/)
    expect(url.startsWith(`${base}/r/`)).toBe(true)
    expect(res.stderr).toContain('Uploaded 1/1 screenshot(s).')

    const slug = url.slice(`${base}/r/`.length)
    const pub = await (await fetch(`${base}/api/public/runs/${slug}`)).json() as {
      title: string
      status: string
      tests: { title: string }[]
    }
    expect(pub.title).toBe('CLI roundtrip')
    expect(pub.status).toBe('passed')
    expect(pub.tests.map(t => t.title)).toEqual(['uploads through the real CLI'])
  })

  it('re-upload with --series keeps the slug and bumps the version to 2', async () => {
    const first = uploadJson(await runCli(['upload', runDir, '--endpoint', base, '--series', 'cli-roundtrip', '--json'], homeDir))
    expect(first.version).toBe(1)

    const second = uploadJson(await runCli(
      ['upload', runDir, '--endpoint', base, '--series', 'cli-roundtrip', '--title', 'CLI roundtrip (rerun)', '--json'],
      homeDir,
    ))
    expect(second.id).toBe(first.id)
    expect(second.slug).toBe(first.slug)
    expect(second.version).toBe(2)

    const pub = await (await fetch(`${base}/api/public/runs/${first.slug}`)).json() as {
      title: string
      version: number
      latest_version: number
    }
    expect(pub.title).toBe('CLI roundtrip (rerun)')
    expect(pub.version).toBe(2)
    expect(pub.latest_version).toBe(2)
  })

  it('fails fast with a clear message when the IdP token has a bad signature', async () => {
    const { privateKey: wrongKey } = await generateKeyPair('ES256', { extractable: true })
    const badHome = await seedHome(wrongKey)

    const res = await runCli(['upload', runDir, '--endpoint', base], badHome)
    expect(res.status, 'CLI must exit, not hang').not.toBeNull()
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/Token exchange failed|apes login/)
  })

  it('fails fast when auth.json is unparseable', async () => {
    const home = makeTempDir('testrun-cli-badhome-')
    const configDir = join(home, '.config', 'apes')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'auth.json'), 'not json {')

    const res = await runCli(['upload', runDir, '--endpoint', base], home)
    expect(res.status, 'CLI must exit, not hang').not.toBeNull()
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/Not logged in|apes login/)
  })
})
