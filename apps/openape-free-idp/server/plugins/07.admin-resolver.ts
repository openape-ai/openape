import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { isOperator, isRootAdmin } from '../utils/admin-claim'

/**
 * Wire the free-idp's DNS-rooted admin model into the
 * `@openape/nuxt-auth-idp` module's resolver hooks (#307). Every
 * incoming request gets two resolvers attached on `event.context`:
 *
 *   - `openapeAdminResolver`     — root OR operator → admin-tier
 *   - `openapeRootAdminResolver` — root only → root-tier
 *
 * `requireAdmin` / `requireRootAdmin` consult these instead of the
 * legacy email allowlist. We deliberately bypass the env-config
 * `OPENAPE_ADMIN_EMAILS` here: free-idp's authority is DNS, not
 * env. Fallback to the email list would create a confusing dual
 * model where someone could be admin without DNS proof.
 */
export default defineNitroPlugin((nitroApp) => {
  if (process.env.OPENAPE_E2E === '1') return

  nitroApp.hooks.hook('request', (event) => {
    const issuer = useRuntimeConfig().openapeIdp?.issuer as string | undefined
    if (!issuer) return

    const db = useDb()

    event.context.openapeRootAdminResolver = async (_event, email) => {
      return isRootAdmin(db, issuer, email)
    }

    event.context.openapeAdminResolver = async (_event, email) => {
      if (await isRootAdmin(db, issuer, email)) return true
      return isOperator(db, email)
    }
  })
})
