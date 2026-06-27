import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

// CLI-track E2E: boots the real testrun app against an in-memory libsql and
// drives the headline proof-link flow over HTTP — authenticate, upload a run
// manifest, then fetch the public /r/<slug> proof link. This is the same
// behaviour the `ape-testruns` CLI exercises, and the pilot scenario for the
// E2E→guide generator.

const SP_SECRET = 'e2e-test-session-secret-at-least-32chars'
const CLIENT_ID = 'testrun.openape.ai'

// Forge an SP-scoped CLI token the booted app's verifyCliToken accepts: same
// HS256 secret + clientId (issuer/audience) the SP is configured with.
function cliToken(email = 'uploader@openape.ai', act: 'human' | 'agent' = 'human') {
  return new SignJWT({ typ: 'cli', sub: email, email, act })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CLIENT_ID)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SP_SECRET))
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

describe('testrun proof-link — CLI-track E2E', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('..', import.meta.url)),
    server: true,
    env: {
      NUXT_TURSO_URL: ':memory:',
      NUXT_OPENAPE_SP_SESSION_SECRET: SP_SECRET,
      NUXT_OPENAPE_SP_CLIENT_ID: CLIENT_ID,
      NUXT_PUBLIC_URL: 'http://localhost',
    },
  })

  it('serves /api/health from the booted app', async () => {
    expect(await $fetch<{ ok: boolean }>('/api/health')).toMatchObject({ ok: true })
  })

  it('rejects an unauthenticated upload with 401', async () => {
    const res = await fetch('/api/runs', { method: 'POST', body: JSON.stringify(manifest), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(401)
  })

  it('uploads a run and serves it back on the public proof link', async () => {
    const created = await $fetch<{ id: string, slug: string, url: string }>('/api/runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await cliToken()}` },
      body: manifest,
    })
    expect(typeof created.slug).toBe('string')
    expect(created.url).toContain(`/r/${created.slug}`)

    // Public proof link — no auth, whoever has the slug can read it.
    const pub = await $fetch<{ title: string, status: string, tests: { title: string }[] }>(`/api/public/runs/${created.slug}`)
    expect(pub.title).toBe('Login flow')
    expect(pub.status).toBe('failed') // one test failed → run failed
    expect(pub.tests.map(t => t.title)).toEqual(['logs in with a passkey', 'rejects a bad credential'])
  })
})
