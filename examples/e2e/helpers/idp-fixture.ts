import type { RunningServer } from './lifecycle.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir, startServer } from './lifecycle.js'

// Boots `examples/idp` — the DDISA Identity Provider built on
// @openape/nuxt-auth-idp — as a throwaway server for a test suite. Every boot
// gets its own port and its own filesystem store, so suites stay isolated from
// each other and from previous runs.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const IDP_DIR = join(repoRoot, 'examples', 'idp')

const SESSION_SECRET = 'e2e-session-secret-at-least-32-characters-long'
// Nuxt boots under parallel CI load can exceed the default startup window.
// Local boots take ~4s; the shared docker CI runner needs far longer for the
// first `nuxt dev` (cold vite dep-optimization, contended CPU) — 120s tripped
// on 4 of 5 files in run 3243 while passing locally.
const BOOT_TIMEOUT_MS = 300_000

export interface IdpFixtureOptions {
  /** Bearer token accepted on the admin endpoints. */
  managementToken: string
  /** Emails treated as IdP admins. */
  adminEmails?: string[]
  /** Fixed port; a free one is picked when omitted. */
  port?: number
  host?: string
  /**
   * DDISA records the IdP resolves instead of querying DNS. The `mode` of the
   * user's domain drives the /authorize consent policy, so a suite that walks
   * the OIDC flow has to declare the record its test users' domain publishes.
   */
  ddisaMockRecords?: Record<string, { version?: string, idp: string, mode?: string }>
}

/**
 * Start an IdP and return its handle. `server.url` is also the issuer, so
 * discovery documents and issued tokens point back at this instance.
 */
export function startIdp(opts: IdpFixtureOptions): Promise<RunningServer> {
  return startServer({
    cwd: IDP_DIR,
    host: opts.host ?? '127.0.0.1',
    port: opts.port,
    readyPath: '/.well-known/openid-configuration',
    timeoutMs: BOOT_TIMEOUT_MS,
    env: ({ url }) => ({
      // Nuxt refuses a second `nuxt dev` in a project directory that already
      // has one. That guard is for humans; test servers are deliberately
      // short-lived, each on its own port and its own store.
      NUXT_IGNORE_LOCK: '1',
      NUXT_OPENAPE_ISSUER: url,
      NUXT_OPENAPE_RP_ORIGIN: url,
      NUXT_OPENAPE_RP_ID: new URL(url).hostname,
      NUXT_OPENAPE_MANAGEMENT_TOKEN: opts.managementToken,
      NUXT_OPENAPE_ADMIN_EMAILS: (opts.adminEmails ?? []).join(','),
      NUXT_OPENAPE_SESSION_SECRET: SESSION_SECRET,
      NUXT_OPENAPE_DATA_DIR: makeTempDir('openape-idp-fixture-'),
      DDISA_MOCK_RECORDS: opts.ddisaMockRecords ? JSON.stringify(opts.ddisaMockRecords) : undefined,
    }),
  })
}
