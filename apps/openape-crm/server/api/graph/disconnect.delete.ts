import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { graphAccounts } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  await useDb().delete(graphAccounts).where(eq(graphAccounts.userEmail, caller.email))
  return { connected: false }
})
