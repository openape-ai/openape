import { generateKeyPairSync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { loadConfig } from 'test2docs'
import { bootstrapTestUser, bootstrapTestUserSshKey } from 'openape-e2e/bootstrap'
import { IDP_PORT, IDP_URL, MANAGEMENT_TOKEN, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER, keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { startServer } from 'openape-e2e/lifecycle'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { AGENT_STORAGE_STATE, AGENT_USER, APP_PORT, APP_URL, STORAGE_STATE } from './constants'

// Boots a throwaway IdP plus this app, and signs in both sides of a question:
// the person asking and the service-agent answering. Without the second one
// the manual could only show a spinner.

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SESSION_SECRET = 'docs-session-secret-at-least-32-characters-long'
const CLIENT_ID = 'question-service.example.com'
const DB_FILE = '.docs-run.db'
const DDISA_MOCK_RECORDS = {
  'example.com': { version: 'ddisa1', idp: IDP_URL, mode: 'open' },
}

// The agent needs a key of its own — the IdP maps a key to one account.
const agentKeys = generateKeyPairSync('ed25519')
const AGENT_PUBLIC_KEY_SSH = keyObjectToSshString(agentKeys.publicKey, AGENT_USER.email)

export default async function globalSetup(): Promise<() => Promise<void>> {
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
    NUXT_OPENAPE_CLIENT_ID: CLIENT_ID,
    NUXT_OPENAPE_SP_SESSION_SECRET: SESSION_SECRET,
    DDISA_MOCK_RECORDS: JSON.stringify(DDISA_MOCK_RECORDS),
    NUXT_TURSO_URL: `file:${join(APP_DIR, DB_FILE)}`,
    NUXT_AGENT_SERVICE_EMAIL: AGENT_USER.email,
  }

  // Production build, not `nuxt dev`: a dev server paints its devtools badge
  // over every screenshot, and it lives in a shadow root page CSS cannot reach.
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
  await bootstrapTestUser(AGENT_USER)
  await bootstrapTestUserSshKey(AGENT_USER.email, AGENT_PUBLIC_KEY_SSH)

  await signIn(TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, STORAGE_STATE)
  await signIn(AGENT_USER.email, agentKeys.privateKey, AGENT_PUBLIC_KEY_SSH, AGENT_STORAGE_STATE)

  return async () => {
    await Promise.all([app.stop(), idp.stop()])
  }
}

/** The OIDC dance from the HTTP suite, ending in a saved browser session. */
async function signIn(
  email: string,
  privateKey: Parameters<typeof loginWithSshKey>[2],
  publicKeySsh: string,
  statePath: string,
): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const login = await context.request.post(`${APP_URL}/api/login`, { data: { email } })
  if (!login.ok()) throw new Error(`SP login failed for ${email} (${login.status()}): ${await login.text()}`)
  const { redirectUrl } = await login.json() as { redirectUrl: string }

  const jwt = await loginWithSshKey(IDP_URL, email, privateKey, publicKeySsh)
  const authorize = await context.request.get(redirectUrl, {
    headers: { Authorization: `Bearer ${jwt}` },
    maxRedirects: 0,
  })
  if (authorize.status() !== 302) throw new Error(`/authorize did not issue a code for ${email} (${authorize.status()})`)

  // Must be a navigation: the SP flow cookie is Secure, and only the browser
  // treats http://127.0.0.1 as a trustworthy origin and sends it back.
  await page.goto(new URL(authorize.headers().location!, APP_URL).href)

  mkdirSync(dirname(statePath), { recursive: true })
  await context.storageState({ path: statePath })
  await browser.close()
}
