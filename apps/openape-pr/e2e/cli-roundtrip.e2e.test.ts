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

// CLI roundtrip E2E: drives the REAL built `ape-pr` binary (subprocess)
// against a locally booted pr app — proving that CLI build, the
// @openape/cli-auth chain (auth.json → /api/cli/exchange → cached SP token)
// and the server API work together, not just in isolation.
//
// Auth chain under test, end to end (same rig as the ape-testruns roundtrip):
//   1. An in-process fake IdP serves a JWKS (startAppServer).
//   2. auth.json in an isolated HOME carries an IdP token signed by that key
//      (iss = fake IdP, aud = 'apes-cli' — exactly what `apes login` stores).
//   3. The CLI exchanges it at the booted SP's /api/cli/exchange; the SP
//      resolves the subject's IdP via DDISA_MOCK_RECORDS (env mock in
//      @openape/core's resolver) and verifies against the fake JWKS —
//      OPENAPE_SP_ALLOW_INSECURE_IDP=1 lets the loopback issuer through the
//      SSRF guard.
//   4. The minted HS256 SP token authenticates upload, status poll — and the
//      direct review POST this suite issues in place of the web UI.

const SECRET = 'e2e-cli-roundtrip-secret-at-least-32-chars'
const UPLOADER = 'uploader@e2e.test'
const IDP_KID = 'e2e-idp'
const CLI_TIMEOUT_MS = 60_000

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const monorepoRoot = resolve(appRoot, '..', '..')
const cliPath = join(monorepoRoot, 'packages', 'ape-pr', 'dist', 'cli.mjs')

// 1x1 transparent PNG — enough to exercise the asset PUT with real bytes.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// 1 file, +2/-1 — small but a real git-style unified diff so diffStats and
// the diff2html-facing raw diff both have something to chew on.
const DIFF = [
  'diff --git a/src/hello.ts b/src/hello.ts',
  'index 0000000..1111111 100644',
  '--- a/src/hello.ts',
  '+++ b/src/hello.ts',
  '@@ -1,3 +1,4 @@',
  ' export function hello() {',
  '-  return \'hello\'',
  '+  return \'hello, world\'',
  '+  // touched by the ape-pr roundtrip',
  ' }',
  '',
].join('\n')

const manifest = {
  title: 'CLI roundtrip PR',
  description: 'Uploaded by the real ape-pr binary.\n\n![shot](shot.png)',
  branch: 'test/cli-roundtrip',
  authorAct: 'agent',
}

let idp: RunningAppServer
let server: RunningServer
let base = ''
let idpKey: KeyLike
let homeDir = ''
let prDir = ''

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
  const home = makeTempDir('pr-cli-home-')
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

function makePrDir(): string {
  const dir = makeTempDir('pr-cli-upload-')
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'diff.patch'), DIFF)
  writeFileSync(join(dir, 'shot.png'), TINY_PNG)
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
// way in the testrun twin). Timeout + SIGKILL are the hang guard: a stuck CLI
// yields status null.
function runCli(args: string[], home: string): Promise<CliResult> {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [cliPath, ...args], {
      timeout: CLI_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        HOME: home,
        OPENAPE_CLI_AUTH_HOME: join(home, '.config', 'apes'),
        // No APE_PR_ENDPOINT here on purpose: every invocation passes
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
  review_url: string
  files: number
  additions: number
  deletions: number
  images_uploaded: number
}

function uploadJson(res: CliResult): UploadJson {
  expect(res.status, `CLI failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0)
  return JSON.parse(res.stdout) as UploadJson
}

// The direct API calls below stand in for the web UI (same bearer auth the
// session cookie maps to): mint an SP token exactly like the CLI does.
async function exchangeSpToken(): Promise<string> {
  const res = await fetch(`${base}/api/cli/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject_token: await forgeIdpToken(idpKey) }),
  })
  expect(res.status, await res.clone().text()).toBe(201)
  const { access_token } = await res.json() as { access_token: string }
  return access_token
}

beforeAll(() => {
  // Build the real CLI (plus its workspace deps) through turbo — warm caches
  // make this a no-op locally and cheap in CI.
  const build = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@openape/ape-pr'], {
    cwd: monorepoRoot,
    encoding: 'utf-8',
    timeout: 240_000,
  })
  if (build.status !== 0 || !existsSync(cliPath)) {
    throw new Error(`Building @openape/ape-pr failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`)
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

  const db = join(makeTempDir('pr-cli-e2e-'), 'e2e.db')
  server = await startServer({
    cwd: appRoot,
    readyPath: '/api/health',
    timeoutMs: 150_000,
    env: ({ url }) => ({
      NUXT_IGNORE_LOCK: '1',
      NUXT_TURSO_URL: `file:${db}`,
      NUXT_OPENAPE_SP_SESSION_SECRET: SECRET,
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
  prDir = makePrDir()
}, 240_000)

afterAll(async () => {
  await server?.stop()
  await idp?.stop()
})

describe('ape-pr CLI roundtrip (real binary against a booted server)', () => {
  it('uploads a PR: exit 0, review URL on stdout, diff served by the API', async () => {
    const res = await runCli(['upload', prDir, '--endpoint', base], homeDir)
    expect(res.status, `CLI failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0)

    // Agent contract: stdout carries only the review link.
    const url = res.stdout.trim()
    expect(url.startsWith(`${base}/prs/`)).toBe(true)
    expect(res.stderr).toContain('PR created — 1 file(s), +2/-1')
    expect(res.stderr).toContain('Uploaded 1 image(s).')

    const id = url.slice(`${base}/prs/`.length)
    const token = await exchangeSpToken()
    const pr = await (await fetch(`${base}/api/prs/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })).json() as {
      title: string
      branch: string
      status: string
      diff: string
      files: number
      additions: number
      deletions: number
      created_by: string
      author_act: string
    }
    expect(pr.title).toBe('CLI roundtrip PR')
    expect(pr.branch).toBe('test/cli-roundtrip')
    expect(pr.status).toBe('pending')
    expect(pr.diff).toBe(DIFF.trim())
    expect(pr.files).toBe(1)
    expect(pr.additions).toBe(2)
    expect(pr.deletions).toBe(1)
    expect(pr.created_by).toBe(UPLOADER)
    expect(pr.author_act).toBe('agent')

    // The image landed as a servable asset.
    const asset = await fetch(`${base}/api/prs/${id}/assets/shot.png`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await asset.arrayBuffer()).equals(TINY_PNG)).toBe(true)
  })

  it('verdict flow: status polls pending (exit 3), then delivers the review (exit 0)', async () => {
    const up = uploadJson(await runCli(['upload', prDir, '--endpoint', base, '--json'], homeDir))
    expect(up.slug).toBeTruthy()

    // Before any review: the CLI reports pending and exits 3 (agent loop code).
    const pending = await runCli(['status', up.slug, '--endpoint', base], homeDir)
    expect(pending.status).toBe(3)
    expect(pending.stdout.trim()).toBe('pending')

    // Submit the verdict server-side — the same authenticated POST the web UI
    // sends when a human reviews.
    const token = await exchangeSpToken()
    const review = await fetch(`${base}/api/prs/${up.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
      body: JSON.stringify({
        verdict: 'approve',
        body: 'Ship it.',
        comments: [{ path: 'src/hello.ts', line: 2, side: 'new', body: 'Nice greeting.' }],
      }),
    })
    expect(review.status, await review.clone().text()).toBe(201)

    // The CLI now sees the verdict: exit 0, human-readable output …
    const reviewed = await runCli(['status', up.slug, '--endpoint', base], homeDir)
    expect(reviewed.status, `stdout:\n${reviewed.stdout}\nstderr:\n${reviewed.stderr}`).toBe(0)
    expect(reviewed.stdout).toContain('verdict: approve')
    expect(reviewed.stdout).toContain('Ship it.')
    expect(reviewed.stdout).toContain('src/hello.ts:2 (new) — Nice greeting.')

    // … and the JSON contract an agent would parse.
    const asJson = await runCli(['status', up.slug, '--endpoint', base, '--json'], homeDir)
    expect(asJson.status).toBe(0)
    const poll = JSON.parse(asJson.stdout) as {
      state: string
      verdict: string
      body: string
      comments: Array<{ path: string, line: number }>
    }
    expect(poll.state).toBe('reviewed')
    expect(poll.verdict).toBe('approve')
    expect(poll.body).toBe('Ship it.')
    expect(poll.comments).toHaveLength(1)
    expect(poll.comments[0]).toMatchObject({ path: 'src/hello.ts', line: 2 })
  })

  it('fails fast with a clear message when the IdP token has a bad signature', async () => {
    const { privateKey: wrongKey } = await generateKeyPair('ES256', { extractable: true })
    const badHome = await seedHome(wrongKey)

    const res = await runCli(['upload', prDir, '--endpoint', base], badHome)
    expect(res.status, 'CLI must exit, not hang').not.toBeNull()
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/Token exchange failed|apes login/)
  })

  it('fails fast when auth.json is unparseable', async () => {
    const home = makeTempDir('pr-cli-badhome-')
    const configDir = join(home, '.config', 'apes')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'auth.json'), 'not json {')

    const res = await runCli(['upload', prDir, '--endpoint', base], home)
    expect(res.status, 'CLI must exit, not hang').not.toBeNull()
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/Not logged in|apes login/)
  })

  it('fails fast when auth.json is missing entirely', async () => {
    const home = makeTempDir('pr-cli-nohome-')

    const res = await runCli(['upload', prDir, '--endpoint', base], home)
    expect(res.status, 'CLI must exit, not hang').not.toBeNull()
    expect(res.status).not.toBe(0)
    expect(res.stderr).toMatch(/Not logged in|apes login/)
  })
})
