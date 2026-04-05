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
  await ensureTables(db)

  const adminEmailsRaw = config.adminEmails as string
  const adminEmails = adminEmailsRaw.split(',').map(e => e.trim()).filter(Boolean)

  const { app } = createIdPApp(
    {
      issuer: config.issuer as string,
      managementToken: (config.managementToken as string) || undefined,
      sessionSecret: (config.sessionSecret as string) || undefined,
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

  const stack = nitroApp.h3App.stack
  const lastIdx = stack.length - 1
  for (const layer of app.stack) {
    stack.splice(lastIdx, 0, layer)
  }
})
