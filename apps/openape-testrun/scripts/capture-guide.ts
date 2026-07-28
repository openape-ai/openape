// Capture the proof-link how-to guide from the REAL app, end to end:
//   boot dev → upload the scenario run → screenshot /r/<slug> at 3 viewports
//   (Playwright) → render the self-contained HTML via scripts/build-guide.mjs.
//
//   pnpm --filter @openape-testrun/app guide
//
// Dev-mode (not the Nitro production build) is deliberate: it uses the
// node_modules libsql, sidestepping the bundled-binding break in the test/prod
// build (see the SP-app-e2e-harness memory). Run on a dedicated port so it
// never clashes with `pnpm dev`.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { chromium } from 'playwright-core'
import { proofLinkScenario, VIEWPORTS } from '../e2e/scenarios/proof-link'

const PORT = 3399
const SECRET = 'guide-capture-secret-at-least-32-characters'
const CLIENT_ID = 'testrun.openape.ai'
const BASE = `http://localhost:${PORT}`
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(appDir, '.guide')

async function cliToken() {
  return new SignJWT({ typ: 'cli', sub: 'demo@openape.ai', email: 'demo@openape.ai', act: 'human' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(CLIENT_ID)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    }
    catch {}
    await sleep(2000)
  }
  throw new Error('dev server did not become healthy')
}

mkdirSync(outDir, { recursive: true })
const dev = spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', String(PORT)], {
  cwd: appDir,
  detached: true, // own process group so we can kill the whole tree
  stdio: 'ignore',
  env: {
    ...process.env,
    NUXT_IGNORE_LOCK: '1',
    NUXT_TURSO_URL: `file:${outDir}/capture.db`,
    NUXT_OPENAPE_SP_SESSION_SECRET: SECRET,
    NUXT_OPENAPE_SP_CLIENT_ID: CLIENT_ID,
    NUXT_PUBLIC_URL: BASE,
  },
})

try {
  await waitForHealth()

  const created = await $fetchRun()
  const shots = await capture(created.slug)

  const guide = {
    title: proofLinkScenario.title,
    intro: proofLinkScenario.intro,
    steps: proofLinkScenario.steps.map(step => ({
      key: step.key,
      caption: step.caption,
      cli: step.key === 'upload'
        ? { command: step.cli.command, output: `✓ hochgeladen\n  ${created.url}` }
        : { command: step.cli.command.replace('<slug>', created.slug), output: `"${proofLinkScenario.manifest.tests.some(t => t.status === 'failed') ? 'failed' : 'passed'}"` },
      browser: step.browserPath ? shots : undefined,
    })),
  }
  writeFileSync(`${outDir}/proof-link.json`, JSON.stringify(guide))
  execFileSync('node', [resolve(appDir, '../../scripts/build-guide.mjs'), `${outDir}/proof-link.json`, `${outDir}/proof-link.html`], { stdio: 'inherit' })
}
finally {
  try { process.kill(-dev.pid!, 'SIGTERM') }
  catch {}
}

async function $fetchRun(): Promise<{ slug: string, url: string }> {
  const res = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${await cliToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(proofLinkScenario.manifest),
  })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  return res.json()
}

async function capture(slug: string): Promise<Record<string, string>> {
  const browser = await chromium.launch()
  try {
    const shots: Record<string, string> = {}
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport })
      // 'load' (not 'networkidle') + a generous timeout: in dev the first hit
      // to a route triggers an on-demand compile that networkidle can outwait.
      await page.goto(`${BASE}/r/${slug}`, { waitUntil: 'load', timeout: 60000 })
      await page.waitForLoadState('networkidle').catch(() => {})
      shots[name] = (await page.screenshot()).toString('base64')
      await page.close()
    }
    return shots
  }
  finally {
    await browser.close()
  }
}
