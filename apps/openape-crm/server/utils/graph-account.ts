import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { graphAccounts } from '../database/schema'
import type { GraphAppConfig, GraphFetch } from './graph'
import { refreshAccessToken, requireGraphConfigured } from './graph'
import { createProblemError } from './problem'
import { decryptSecret, encryptSecret } from './secret'

export function graphAppConfig(): GraphAppConfig {
  const c = useRuntimeConfig()
  return {
    clientId: String(c.graphClientId || ''),
    clientSecret: String(c.graphClientSecret || ''),
    tokenSecret: String(c.graphTokenSecret || ''),
    publicUrl: String(c.publicUrl || 'https://crm.openape.ai'),
    webhookUrl: String(c.graphWebhookUrl || ''),
  }
}

export async function requireGraphAccess(email: string, fetchImpl: GraphFetch = fetch) {
  const cfg = graphAppConfig()
  requireGraphConfigured(cfg)
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
  return { accessToken: tokens.access_token, mail: row.mail, cfg, db }
}
