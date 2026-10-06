import { spawnSync } from 'node:child_process'
import { sign } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { loadConfig } from 'test2docs'
import { bootstrapTestUser, bootstrapTestUserSshKey } from 'openape-e2e/bootstrap'
import { IDP_PORT, IDP_URL, MANAGEMENT_TOKEN, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { startServer } from 'openape-e2e/lifecycle'
import { APP_PORT, APP_URL, STORAGE_STATE } from './constants'

// Boots a throwaway IdP plus this app and leaves a signed-in browser state
// behind, so the documented flows start where a reader would: logged in.
// Ports are fixed on purpose — openape-e2e's constants (and with them the
// test user's key pair) are per-process, so the login has to happen here.

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SESSION_SECRET = 'docs-session-secret-at-least-32-characters-long'
const CLIENT_ID = 'troop.example.com'
const DB_FILE = '.docs-run.db'
const DDISA_MOCK_RECORDS = {
  'example.com': { version: 'ddisa1', idp: IDP_URL, mode: 'open' },
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // A documentation run tells one story from an empty product, so it starts
  // from an empty database and an empty recording.
  const { config, root } = loadConfig(join(APP_DIR, 'test2docs.config.json'))
  rmSync(join(APP_DIR, DB_FILE), { force: true })
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
    NUXT_PUBLIC_IDP_URL: idp.url,
    NUXT_OPENAPE_CLIENT_ID: CLIENT_ID,
    NUXT_OPENAPE_SP_SESSION_SECRET: SESSION_SECRET,
    DDISA_MOCK_RECORDS: JSON.stringify(DDISA_MOCK_RECORDS),
    NUXT_TURSO_URL: `file:${join(APP_DIR, DB_FILE)}`,
  }

  // Production build, not `nuxt dev`: the manual has to show the app a reader
  // gets, and a dev server paints its devtools badge over every screenshot.
  // The build gets the same env as the server — nuxt.config reads these at
  // config time, so building without them bakes in the production values.
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
    await Promise.all([app.stop(), idp.stop()])
  }
}

/**
 * Sign the browser in the way a person does: get an IdP session first, then let
 * the OIDC redirect run as a plain navigation. The IdP accepts an SSH key for a
 * browser session (`/api/session/login`), which is what saves this run from
 * needing a passkey.
 */
async function signIn(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const challengeRes = await context.request.post(`${IDP_URL}/api/auth/challenge`, { data: { id: TEST_USER.email } })
  if (!challengeRes.ok()) throw new Error(`Challenge failed (${challengeRes.status()}): ${await challengeRes.text()}`)
  const { challenge } = await challengeRes.json() as { challenge: string }

  const idpLogin = await context.request.post(`${IDP_URL}/api/session/login`, {
    data: {
      id: TEST_USER.email,
      challenge,
      signature: sign(null, Buffer.from(challenge), TEST_SSH_PRIVATE_KEY).toString('base64'),
      public_key: TEST_SSH_PUBLIC_KEY,
    },
  })
  if (!idpLogin.ok()) throw new Error(`IdP session login failed (${idpLogin.status()}): ${await idpLogin.text()}`)

  const spLogin = await context.request.post(`${APP_URL}/api/login`, { data: { email: TEST_USER.email } })
  if (!spLogin.ok()) throw new Error(`SP login failed (${spLogin.status()}): ${await spLogin.text()}`)
  const { redirectUrl } = await spLogin.json() as { redirectUrl: string }

  // One navigation covers authorize → callback → app: the browser carries both
  // the IdP session and the SP's Secure flow cookie, which an API request
  // context would not send over plain http.
  await page.goto(redirectUrl)

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await context.storageState({ path: STORAGE_STATE })
  await browser.close()
}
