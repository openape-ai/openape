import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { loadConfig } from 'test2docs'
import { bootstrapTestUser, bootstrapTestUserSshKey } from 'openape-e2e/bootstrap'
import { IDP_PORT, IDP_URL, MANAGEMENT_TOKEN, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { APP_PORT, APP_URL, STORAGE_STATE } from './constants'

// Boots a throwaway IdP plus this app and leaves a signed-in browser state
// behind, so the documented flows start where a reader would: logged in.
// Ports are fixed on purpose — openape-e2e's constants (and with them the
// test user's key pair) are per-process, so the login has to happen here.

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SESSION_SECRET = 'docs-session-secret-at-least-32-characters-long'
const CLIENT_ID = 'plans.example.com'
const REPORTS_DIR = resolve(APP_DIR, '../openape-testrun')
const REPORTS_PORT = APP_PORT + 2
const REPORTS_URL = `http://127.0.0.1:${REPORTS_PORT}`
const BRIDGE_SECRET = 'docs-plans-reports-bridge-secret-at-least-32'
const DDISA_MOCK_RECORDS = {
  'example.com': { version: 'ddisa1', idp: IDP_URL, mode: 'open' },
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // A documentation run tells one story from an empty product, so it starts
  // from an empty database and an empty recording. Without this the second run
  // finds the first run's team and the "no teams yet" screenshot is gone.
  const { config, root } = loadConfig(join(APP_DIR, 'test2docs.config.json'))
  const database = join(makeTempDir('plans-docs-reports-'), 'reports.db')
  rmSync(resolve(root, config.inDir), { recursive: true, force: true })

  const idp = await startIdp({
    host: '127.0.0.1',
    port: IDP_PORT,
    managementToken: MANAGEMENT_TOKEN,
    adminEmails: [TEST_USER.email],
    ddisaMockRecords: DDISA_MOCK_RECORDS,
  })

  const appEnv = {
    NUXT_OPENAPE_URL: idp.url,
    NUXT_FALLBACK_IDP_URL: idp.url,
    OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
    NUXT_OPENAPE_CLIENT_ID: CLIENT_ID,
    NUXT_OPENAPE_SP_SESSION_SECRET: SESSION_SECRET,
    DDISA_MOCK_RECORDS: JSON.stringify(DDISA_MOCK_RECORDS),
    NUXT_REPORTS_ORIGIN: REPORTS_URL,
    NUXT_REPORTS_BRIDGE_SECRET: BRIDGE_SECRET,
  }

  const reportsEnv = { ...appEnv, NUXT_OPENAPE_CLIENT_ID: 'reports.example.com', NUXT_TURSO_URL: `file:${database}`, NUXT_PLANS_CONSOLIDATED: 'true', NUXT_PLANS_BRIDGE_SECRET: BRIDGE_SECRET, NUXT_PLANS_INVITE_SECRET: 'docs-plans-invitation-secret-at-least-32' }
  const reportsBuild = spawnSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: REPORTS_DIR, encoding: 'utf8', env: { ...process.env, ...reportsEnv } })
  if (reportsBuild.status !== 0) throw new Error(`Reports build failed:\n${reportsBuild.stdout}\n${reportsBuild.stderr}`)
  const reports = await startServer({ cwd: REPORTS_DIR, host: '127.0.0.1', port: REPORTS_PORT, readyPath: '/api/health', timeoutMs: 300_000, command: () => ['node', '.output/server/index.mjs'], env: { ...reportsEnv, PORT: String(REPORTS_PORT), HOST: '127.0.0.1' } })

  // Production build, not `nuxt dev`: the manual has to show the app a reader
  // gets. A dev server paints the devtools badge over every screenshot, and it
  // lives in a shadow root that page CSS cannot reach. ~15s, once per run.
  // The build gets the same env as the server — nuxt.config reads
  // NUXT_OPENAPE_CLIENT_ID at config time, so building without it bakes in the
  // production client_id and /authorize answers 400.
  const built = spawnSync('pnpm', ['exec', 'nuxt', 'build'], {
    cwd: APP_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...appEnv },
  })
  if (built.status !== 0) throw new Error(`nuxt build failed:\n${built.stdout}\n${built.stderr}`)

  const app = await startServer({
    cwd: APP_DIR,
    host: '127.0.0.1',
    port: APP_PORT,
    readyPath: '/api/health',
    timeoutMs: 300_000,
    command: () => ['node', '.output/server/index.mjs'],
    env: { PORT: String(APP_PORT), HOST: '127.0.0.1', ...appEnv },
  })

  await bootstrapTestUser(TEST_USER)
  await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)

  await signIn()

  return async () => {
    await Promise.all([app.stop(), reports.stop(), idp.stop()])
  }
}

/** The OIDC dance from the HTTP suite, ending in a saved browser session. */
async function signIn(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const jwt = await loginWithSshKey(IDP_URL, TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)
  for (const endpoint of [APP_URL, REPORTS_URL]) {
    const login = await context.request.post(`${endpoint}/api/login`, { data: { email: TEST_USER.email } })
    if (!login.ok()) throw new Error(`SP login failed (${login.status()}): ${await login.text()}`)
    const { redirectUrl } = await login.json() as { redirectUrl: string }
    const authorize = await context.request.get(redirectUrl, { headers: { Authorization: `Bearer ${jwt}` }, maxRedirects: 0 })
    if (authorize.status() !== 302) throw new Error(`/authorize did not issue a code (${authorize.status()})`)
    await page.goto(new URL(authorize.headers().location!, endpoint).href)
  }

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await context.storageState({ path: STORAGE_STATE })
  await browser.close()
}
