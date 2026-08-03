import type { RunningServer } from './lifecycle.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDP_PORT, IDP_URL, IS_PROD, MANAGEMENT_TOKEN, SP_ID, SP_PORT } from './constants.js'
import { startIdp } from './idp-fixture.js'
import { startServer } from './lifecycle.js'

// The suite drives the shipped apps — `examples/idp` (@openape/nuxt-auth-idp)
// and `examples/sp` (@openape/nuxt-auth-sp), booted as `nuxt dev` servers.
// Those are the same code paths that serve production traffic.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SP_DIR = join(repoRoot, 'examples', 'sp')

const SESSION_SECRET = 'e2e-session-secret-at-least-32-characters-long'
const ADMIN_EMAIL = 'admin@example.com'
// Local boots take ~4s; the shared docker CI runner needs far longer for the
// first `nuxt dev` (cold vite dep-optimization, contended CPU) — 120s tripped
// on 4 of 5 files in run 3243 while passing locally.
const BOOT_TIMEOUT_MS = 300_000

/**
 * DDISA record for the test domain, resolved instead of real DNS. Both sides
 * need it: the SP to discover the IdP, the IdP to read `mode=open` — the
 * domain's declaration that its users need no per-SP consent prompt.
 */
const DDISA_MOCK_RECORDS = {
  'example.com': { version: 'ddisa1', idp: IDP_URL, mode: 'open' },
}

let idpServer: RunningServer | null = null
let spServer: RunningServer | null = null

export async function startServers(): Promise<void> {
  if (IS_PROD) {
    return
  }

  ;[idpServer, spServer] = await Promise.all([
    startIdp({
      host: '127.0.0.1',
      port: IDP_PORT,
      managementToken: MANAGEMENT_TOKEN,
      adminEmails: [ADMIN_EMAIL],
      ddisaMockRecords: DDISA_MOCK_RECORDS,
    }),
    startServer({
      cwd: SP_DIR,
      host: '127.0.0.1',
      port: SP_PORT,
      readyPath: '/.well-known/openape.json',
      timeoutMs: BOOT_TIMEOUT_MS,
      env: {
        NUXT_OPENAPE_CLIENT_ID: SP_ID,
        NUXT_OPENAPE_URL: IDP_URL,
        NUXT_OPENAPE_SP_SESSION_SECRET: SESSION_SECRET,
        DDISA_MOCK_RECORDS: JSON.stringify(DDISA_MOCK_RECORDS),
      },
    }),
  ])
}

export async function stopServers(): Promise<void> {
  if (IS_PROD) return
  await Promise.all([
    idpServer?.stop() ?? Promise.resolve(),
    spServer?.stop() ?? Promise.resolve(),
  ])
  idpServer = null
  spServer = null
}
