import { createDrizzleUserStore } from '../utils/drizzle-user-store'
import { createDrizzleRefreshTokenStore } from '../utils/drizzle-refresh-token-store'
import { createDrizzleCodeStore } from '../utils/drizzle-code-store'
import { createDrizzleJtiStore } from '../utils/drizzle-jti-store'
import { createDrizzleCredentialStore } from '../utils/drizzle-credential-store'
import { createDrizzleChallengeStore } from '../utils/drizzle-challenge-store'
import { createDrizzleRegistrationUrlStore } from '../utils/drizzle-registration-url-store'
import { createDrizzleKeyStore } from '../utils/drizzle-key-store'
import { createDrizzleSshKeyStore } from '../utils/drizzle-ssh-key-store'
import { createDrizzleConsentStore } from '../utils/drizzle-consent-store'
import { createDrizzleAdminAllowlistStore } from '../utils/drizzle-admin-allowlist-store'

export default defineNitroPlugin(() => {
  if (process.env.OPENAPE_E2E === '1') return

  // Users (unified — no separate agent store)
  defineUserStore(() => createDrizzleUserStore())

  // Milestone 2: Auth Tokens
  defineRefreshTokenStore(() => createDrizzleRefreshTokenStore())
  defineCodeStore(() => createDrizzleCodeStore())
  defineJtiStore(() => createDrizzleJtiStore())

  // Milestone 3: WebAuthn
  defineCredentialStore(() => createDrizzleCredentialStore())
  defineWebAuthnChallengeStore(() => createDrizzleChallengeStore())
  defineRegistrationUrlStore(() => createDrizzleRegistrationUrlStore())

  // Milestone 4: Keys
  defineKeyStore(() => createDrizzleKeyStore())

  // Milestone 5: SSH Keys
  defineSshKeyStore(() => createDrizzleSshKeyStore())

  // DDISA allowlist-user consents (#301)
  defineConsentStore(() => createDrizzleConsentStore())

  // DDISA allowlist-admin SP allowlist (#307)
  defineAdminAllowlistStore(() => createDrizzleAdminAllowlistStore())
})
