import type { IdPTestConfig } from './config.js'
import { lazyConfig } from './config.js'
import { adminUsersTests } from './suites/admin-users.js'
import { authTests } from './suites/auth.js'
import { delegationsTests } from './suites/delegations.js'
import { discoveryTests } from './suites/discovery.js'
import { grantsTests } from './suites/grants.js'
import { oidcFlowTests } from './suites/oidc-flow.js'
import { securityTests } from './suites/security.js'
import { sessionTests } from './suites/session.js'
import { sshKeyTests } from './suites/ssh-keys.js'

export type { IdPTestConfig } from './config.js'
export { generateEd25519Key, loginWithKey, sessionLogin, CookieJar, post, get, del } from './helpers.js'

export function runIdPTestSuite(config: IdPTestConfig) {
  const skip = new Set(config.skip ?? [])
  const resolved = lazyConfig(config)

  if (!skip.has('discovery')) discoveryTests(resolved)
  if (!skip.has('admin-users')) adminUsersTests(resolved)
  if (!skip.has('ssh-keys')) sshKeyTests(resolved)
  if (!skip.has('auth')) authTests(resolved)
  if (!skip.has('session')) sessionTests(resolved)
  if (!skip.has('oidc-flow')) oidcFlowTests(resolved)
  if (!skip.has('grants')) grantsTests(resolved)
  if (!skip.has('delegations')) delegationsTests(resolved)
  if (!skip.has('security')) securityTests(resolved)
}
