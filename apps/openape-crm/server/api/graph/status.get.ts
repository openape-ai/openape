import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { graphAccounts } from '../../database/schema'
import { graphAppConfig } from '../../utils/graph-account'
import { isGraphConfigured } from '../../utils/graph'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const cfg = graphAppConfig()
  const row = await useDb().select().from(graphAccounts).where(eq(graphAccounts.userEmail, caller.email)).get()
  return {
    configured: isGraphConfigured(cfg),
    connected: Boolean(row),
    mail: row?.mail ?? null,
  }
})
