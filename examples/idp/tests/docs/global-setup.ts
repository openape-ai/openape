import { spawnSync } from 'node:child_process'
import { sign } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { loadConfig } from 'test2docs'
import { bootstrapTestUser, bootstrapTestUserSshKey } from 'openape-e2e/bootstrap'
import { MANAGEMENT_TOKEN, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from 'openape-e2e/constants'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { APP_PORT, APP_URL, STORAGE_STATE } from './constants'

// Boots this app — the IdP itself — and leaves a signed-in browser state
// behind. The guides that document signing in start from a fresh context
// instead, so both sides of the product are covered.

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SESSION_SECRET = 'docs-session-secret-at-least-32-characters-long'

export default async function globalSetup(): Promise<() => Promise<void>> {
  const { config, root } = loadConfig(join(APP_DIR, 'test2docs.config.json'))
  rmSync(resolve(root, config.inDir), { recursive: true, force: true })

  const appEnv = {
    NUXT_OPENAPE_ISSUER: APP_URL,
    NUXT_OPENAPE_RP_ORIGIN: APP_URL,
    // WebAuthn ties a credential to this host, and it must be a domain — a
    // bare IP is refused outright.
    NUXT_OPENAPE_RP_ID: new URL(APP_URL).hostname,
    NUXT_OPENAPE_MANAGEMENT_TOKEN: MANAGEMENT_TOKEN,
    NUXT_OPENAPE_ADMIN_EMAILS: TEST_USER.email,
    NUXT_OPENAPE_SESSION_SECRET: SESSION_SECRET,
    // Throwaway identity store, so every run documents an empty product.
    NUXT_OPENAPE_DATA_DIR: makeTempDir('openape-idp-docs-'),
  }

  // Production build, not `nuxt dev`: the manual has to show the app a reader
  // gets, and a dev server paints its devtools badge over every screenshot.
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
    readyPath: '/.well-known/openid-configuration',
    timeoutMs: 300_000,
    command: () => ['node', '.output/server/index.mjs'],
    // Bound on every interface: the readiness poll and openape-e2e's helpers
    // address 127.0.0.1, while the browser has to use localhost for WebAuthn.
    env: { PORT: String(APP_PORT), HOST: '0.0.0.0', ...appEnv },
  })

  await bootstrapTestUser(TEST_USER)
  await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)

  await signIn()

  return async () => {
    await app.stop()
  }
}

/**
 * Sign in with the SSH key rather than a passkey: `/api/session/login` starts a
 * browser session from a signed challenge, which is what lets a headless run
 * document the pages behind the login without a real authenticator.
 */
async function signIn(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext()

  const challengeRes = await context.request.post(`${APP_URL}/api/auth/challenge`, { data: { id: TEST_USER.email } })
  if (!challengeRes.ok()) throw new Error(`Challenge failed (${challengeRes.status()}): ${await challengeRes.text()}`)
  const { challenge } = await challengeRes.json() as { challenge: string }

  const login = await context.request.post(`${APP_URL}/api/session/login`, {
    data: {
      id: TEST_USER.email,
      challenge,
      signature: sign(null, Buffer.from(challenge), TEST_SSH_PRIVATE_KEY).toString('base64'),
      public_key: TEST_SSH_PUBLIC_KEY,
    },
  })
  if (!login.ok()) throw new Error(`Session login failed (${login.status()}): ${await login.text()}`)

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await context.storageState({ path: STORAGE_STATE })
  await browser.close()
}
