import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { graphAccounts } from '../database/schema'
import type { GraphAppConfig, GraphFetch } from './graph'
import { accessTokenFresh, refreshAccessToken, requireGraphConfigured } from './graph'
import { createProblemError } from './problem'
import { decryptSecret, encryptSecret } from './secret'

const ACCESS_SKEW_MS = 60_000

interface CachedAccess {
  accessToken: string
  expiresAt: number
  mail: string | null
}

const accessCache = new Map<string, CachedAccess>()

export function graphAppConfig(): GraphAppConfig {
  const c = useRuntimeConfig()
  return {
    clientId: String(c.graphClientId || ''),
    clientSecret: String(c.graphClientSecret || ''),
    tenantId: String(c.graphTenantId || ''),
    tokenSecret: String(c.graphTokenSecret || ''),
    publicUrl: String(c.publicUrl || 'https://crm.openape.ai'),
    webhookUrl: String(c.graphWebhookUrl || ''),
  }
}

export function clearGraphAccessCache(email?: string) {
  if (email) accessCache.delete(email)
  else accessCache.clear()
}

export async function requireGraphAccess(email: string, fetchImpl: GraphFetch = fetch) {
  const cfg = graphAppConfig()
  requireGraphConfigured(cfg)
  const cached = accessCache.get(email)
  if (cached && accessTokenFresh(cached.expiresAt, Date.now(), ACCESS_SKEW_MS)) {
    return { accessToken: cached.accessToken, mail: cached.mail, cfg, db: useDb() }
  }
  const db = useDb()
  const row = await db.select().from(graphAccounts).where(eq(graphAccounts.userEmail, email)).get()
  if (!row) throw createProblemError({ status: 503, title: 'Microsoft verbinden' })
  const refresh = decryptSecret(row.encryptedRefresh, cfg.tokenSecret)
  const tokens = await refreshAccessToken(cfg, refresh, fetchImpl)
  if (tokens.refresh_token) {
    await db.update(graphAccounts).set({
      encryptedRefresh: encryptSecret(tokens.refresh_token, cfg.tokenSecret),
    }).where(eq(graphAccounts.userEmail, email))
  }
  accessCache.set(email, {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    mail: row.mail,
  })
  return { accessToken: tokens.access_token, mail: row.mail, cfg, db }
}
