import type { RunningServer } from 'openape-e2e/lifecycle'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// CLI-track E2E: boots the real testrun app in DEV mode and drives the headline
// proof-link flow over HTTP — authenticate, upload a run manifest, then fetch
// the public /r/<slug> proof link. Same path the `ape-testruns` CLI exercises.
//
// Dev mode (not the Nitro production build) is deliberate: it loads libsql from
// node_modules, sidestepping the bundled-binding break in the production test
// build. Dynamic port + NUXT_IGNORE_LOCK + process-group kill (via the shared
// lifecycle helper) so a stale dev server can't wedge it.

const SECRET = 'e2e-proof-link-secret-at-least-32-characters'
const CLIENT_ID = 'testrun.openape.ai'
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let server: RunningServer
let base = ''

// Forge an SP-scoped CLI token the booted app's verifyCliToken accepts: same
// HS256 secret + clientId (issuer/audience) the SP is configured with.
function cliToken(email = 'uploader@openape.ai', act: 'human' | 'agent' = 'human') {
  return new SignJWT({ typ: 'cli', sub: email, email, act })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CLIENT_ID)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

const manifest = {
  title: 'Login flow',
  project: 'openape',
  summary: 'It works end to end.',
  tests: [
    { id: 't1', title: 'logs in with a passkey', status: 'passed', steps: [{ title: 'open login', caption: 'Landing page' }] },
    { id: 't2', title: 'rejects a bad credential', status: 'failed', error: 'boom', steps: [] },
  ],
}

beforeAll(async () => {
  const db = join(makeTempDir('testrun-e2e-'), 'e2e.db')
  server = await startServer({
    cwd: appRoot,
    readyPath: '/api/health',
    env: ({ url }) => ({
      NUXT_IGNORE_LOCK: '1',
      NUXT_TURSO_URL: `file:${db}`,
      NUXT_OPENAPE_SP_SESSION_SECRET: SECRET,
      NUXT_OPENAPE_SP_CLIENT_ID: CLIENT_ID,
      NUXT_PUBLIC_URL: url,
    }),
  })
  base = server.url
}, 150_000)

afterAll(async () => {
  await server?.stop()
})

describe('proof-link — CLI-track E2E (dev mode)', () => {
  it('serves /api/health from the booted app', async () => {
    expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(true)
  })

  it('rejects an unauthenticated upload with 401', async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(manifest),
    })
    expect(res.status).toBe(401)
  })

  it('uploads a run and serves it back on the public proof link', async () => {
    const created = await (await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await cliToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(manifest),
    })).json() as { slug: string, url: string }
    expect(typeof created.slug).toBe('string')
    expect(created.url).toContain(`/r/${created.slug}`)

    const pub = await (await fetch(`${base}/api/public/runs/${created.slug}`)).json() as { title: string, status: string, tests: { title: string }[] }
    expect(pub.title).toBe('Login flow')
    expect(pub.status).toBe('failed') // one test failed → run failed
    expect(pub.tests.map(t => t.title)).toEqual(['logs in with a passkey', 'rejects a bad credential'])
  })

  it('without a series key every upload mints a fresh link', async () => {
    const upload = async () => await (await fetch(`${BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await cliToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(manifest),
    })).json() as { slug: string, version: number }
    const first = await upload()
    const second = await upload()
    expect(first.version).toBe(1)
    expect(second.version).toBe(1)
    expect(second.slug).not.toBe(first.slug)
  })

  it('re-upload with the same series keeps the link and increments the version', async () => {
    const seriesManifest = { ...manifest, series: 'e2e-feature-branch' }
    const upload = async (body: Record<string, unknown>, email?: string) => {
      const res = await fetch(`${BASE}/api/runs`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${await cliToken(email)}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(201)
      return await res.json() as { id: string, slug: string, version: number }
    }

    const first = await upload(seriesManifest)
    expect(first.version).toBe(1)

    // Same owner, same series → same id + slug, version 2, latest content shown.
    const second = await upload({
      ...seriesManifest,
      title: 'Login flow (fixed)',
      tests: [{ id: 't1', title: 'logs in with a passkey', status: 'passed', steps: [] }],
    })
    expect(second.id).toBe(first.id)
    expect(second.slug).toBe(first.slug)
    expect(second.version).toBe(2)

    const latest = await (await fetch(`${BASE}/api/public/runs/${first.slug}`)).json() as {
      title: string, status: string, version: number, latest_version: number, versions: { version: number, status: string }[]
    }
    expect(latest.title).toBe('Login flow (fixed)')
    expect(latest.status).toBe('passed')
    expect(latest.version).toBe(2)
    expect(latest.latest_version).toBe(2)
    expect(latest.versions.map(v => v.version)).toEqual([2, 1])

    // The archived first version stays viewable via ?v=1.
    const archived = await (await fetch(`${BASE}/api/public/runs/${first.slug}?v=1`)).json() as { title: string, status: string, version: number }
    expect(archived.title).toBe('Login flow')
    expect(archived.status).toBe('failed')
    expect(archived.version).toBe(1)

    // Unknown versions 404 instead of leaking anything.
    expect((await fetch(`${BASE}/api/public/runs/${first.slug}?v=3`)).status).toBe(404)

    // A DIFFERENT owner using the same series cannot touch this link — they
    // get their own independent run.
    const other = await upload(seriesManifest, 'someone-else@openape.ai')
    expect(other.slug).not.toBe(first.slug)
    expect(other.version).toBe(1)
  })
})
