import { eq } from 'drizzle-orm'
import { defineEventHandler, deleteCookie, getCookie, getQuery, sendRedirect } from 'h3'
import { useDb } from '../../../database/drizzle'
import { graphAccounts } from '../../../database/schema'
import { createInboxSubscription, exchangeCode, graphJson } from '../../../utils/graph'
import { graphAppConfig } from '../../../utils/graph-account'
import { encryptSecret } from '../../../utils/secret'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const q = getQuery(event)
  const code = String(q.code ?? '')
  const state = String(q.state ?? '')
  const cookie = getCookie(event, 'oa_graph_state') || ''
  deleteCookie(event, 'oa_graph_state', { path: '/' })
  const expected = cookie.split('.')[0]
  if (!code || !state || !expected || state !== expected) {
    return sendRedirect(event, '/vorgaenge?graph=denied')
  }
  const cfg = graphAppConfig()
  const tokens = await exchangeCode(cfg, code)
  if (!tokens.refresh_token) {
    return sendRedirect(event, '/vorgaenge?graph=norefresh')
  }
  const me = await graphJson<{ id: string, mail?: string, userPrincipalName?: string }>(
    tokens.access_token,
    '/me',
  )
  const mail = me.mail || me.userPrincipalName || caller.email
  const now = Date.now()
  const db = useDb()
  const encrypted = encryptSecret(tokens.refresh_token, cfg.tokenSecret)
  const existing = await db.select().from(graphAccounts).where(eq(graphAccounts.userEmail, caller.email)).get()
  let subscriptionId: string | null = null
  let subscriptionExpires: number | null = null
  if (cfg.webhookUrl.startsWith('https://')) {
    try {
      const sub = await createInboxSubscription(tokens.access_token, cfg.webhookUrl)
      subscriptionId = sub.id
      subscriptionExpires = Date.parse(sub.expirationDateTime)
    }
    catch {
      subscriptionId = null
    }
  }
  if (existing) {
    await db.update(graphAccounts).set({
      graphUserId: me.id,
      mail,
      encryptedRefresh: encrypted,
      subscriptionId,
      subscriptionExpires,
      connectedAt: now,
    }).where(eq(graphAccounts.userEmail, caller.email))
  }
  else {
    await db.insert(graphAccounts).values({
      userEmail: caller.email,
      graphUserId: me.id,
      mail,
      encryptedRefresh: encrypted,
      subscriptionId,
      subscriptionExpires,
      connectedAt: now,
    })
  }
  return sendRedirect(event, '/vorgaenge?graph=ok')
})
