import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { graphAccounts } from '../../database/schema'
import { clearGraphAccessCache } from '../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  await useDb().delete(graphAccounts).where(eq(graphAccounts.userEmail, caller.email))
  clearGraphAccessCache(caller.email)
  return { connected: false }
})
