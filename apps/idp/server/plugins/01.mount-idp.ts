import { createIdPApp } from '@openape/server'
import { useDb } from '../database/client'
import { ensureTables } from '../database/migrate'
import { createDrizzleChallengeStore } from '../stores/challenge-store'
import { createDrizzleCodeStore } from '../stores/code-store'
import { createDrizzleGrantStore } from '../stores/grant-store'
import { createDrizzleJtiStore } from '../stores/jti-store'
import { createDrizzleKeyStore } from '../stores/key-store'
import { createDrizzleRefreshTokenStore } from '../stores/refresh-token-store'
import { createDrizzleSshKeyStore } from '../stores/ssh-key-store'
import { createDrizzleUserStore } from '../stores/user-store'

export default defineNitroPlugin(async (nitroApp) => {
  const config = useRuntimeConfig()
  const db = useDb()

  // Auto-create tables on startup
  await ensureTables(db)

  const adminEmailsRaw = config.adminEmails as string
  const adminEmails = adminEmailsRaw
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)

  const managementToken = config.managementToken as string
  const sessionSecret = config.sessionSecret as string

  const { app } = createIdPApp(
    {
      issuer: config.issuer as string,
      managementToken: managementToken || undefined,
      sessionSecret: sessionSecret || undefined,
      adminEmails: adminEmails.length > 0 ? adminEmails : undefined,
    },
    {
      userStore: createDrizzleUserStore(db),
      sshKeyStore: createDrizzleSshKeyStore(db),
      keyStore: createDrizzleKeyStore(db),
      codeStore: createDrizzleCodeStore(db),
      challengeStore: createDrizzleChallengeStore(db),
      grantStore: createDrizzleGrantStore(db),
      jtiStore: createDrizzleJtiStore(db),
      refreshTokenStore: createDrizzleRefreshTokenStore(db),
    },
  )

  // Mount the @openape/server h3 app layers before Nitro's own router.
  // Nitro's h3App stack contains [middleware..., router]. We insert the IdP
  // app's layers (including its router) just before the last item (Nitro's
  // router) so IdP routes are matched before Nitro's 404 catch-all.
  const nitroStack = nitroApp.h3App.stack
  const nitroRouter = nitroStack.pop()!
  for (const layer of app.stack) {
    nitroStack.push(layer)
  }
  nitroStack.push(nitroRouter)
})
