import { desc, eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { repos } from '../../database/schema'

/** GET /api/repos — the caller's own repositories. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()
  return db.select().from(repos).where(eq(repos.ownerEmail, caller.email)).orderBy(desc(repos.createdAt))
})
