import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $fetch, createPage, setup } from '@nuxt/test-utils/e2e'
import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { proofLinkScenario, VIEWPORTS } from './scenarios/proof-link'

// Capture track: boots the real app, uploads the scenario's run, then drives
// the public /r/<slug> page in a browser and screenshots it at three viewports.
// Emits .guide/proof-link.json which scripts/build-guide.mjs renders into the
// self-contained HTML how-to. Runs in CI (where the Nitro libsql build works);
// locally the Nitro test-build libsql binding is flaky — see the e2e harness
// memory. The screenshot assertions make a broken capture fail the run.

const SECRET = 'guide-e2e-session-secret-at-least-32chars'
const CLIENT_ID = 'testrun.openape.ai'
const here = dirname(fileURLToPath(import.meta.url))

function cliToken() {
  return new SignJWT({ typ: 'cli', sub: 'demo@openape.ai', email: 'demo@openape.ai', act: 'human' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CLIENT_ID)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

describe('proof-link guide capture', async () => {
  await setup({
    rootDir: resolve(here, '..'),
    server: true,
    browser: true,
    browserOptions: { type: 'chromium' },
    env: {
      NUXT_TURSO_URL: ':memory:',
      NUXT_OPENAPE_SP_SESSION_SECRET: SECRET,
      NUXT_OPENAPE_SP_CLIENT_ID: CLIENT_ID,
      NUXT_PUBLIC_URL: 'http://localhost',
    },
  })

  it('uploads the run, screenshots /r/<slug> at 3 viewports, and emits guide JSON', async () => {
    const created = await $fetch<{ slug: string, url: string }>('/api/runs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await cliToken()}` },
      body: proofLinkScenario.manifest,
    })
    expect(typeof created.slug).toBe('string')

    const page = await createPage(`/r/${created.slug}`)
    const shots: Record<string, string> = {}
    for (const [name, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size)
      const buf = await page.screenshot({ fullPage: true })
      expect(buf.byteLength).toBeGreaterThan(1000) // a broken render fails here
      shots[name] = buf.toString('base64')
    }

    const guide = {
      title: proofLinkScenario.title,
      intro: proofLinkScenario.intro,
      steps: proofLinkScenario.steps.map(step => ({
        key: step.key,
        caption: step.caption,
        cli: step.key === 'upload'
          ? { command: step.cli.command, output: `✓ hochgeladen\n  ${created.url}` }
          : step.cli,
        browser: step.browserPath ? shots : undefined,
      })),
    }
    const out = resolve(here, '../.guide/proof-link.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(guide))
    expect(guide.steps.some(s => s.browser)).toBe(true)
  })
})
