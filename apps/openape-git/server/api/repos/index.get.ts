import { desc } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../database/drizzle'
import { useRuntimeConfig } from 'nitropack/runtime'
import { repositoryAccessPredicate } from '../../utils/issue-access'
import { repos } from '../../database/schema'

/** GET /api/repos — owned repositories and live repository grants. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const db = useDb()
  return db.select().from(repos).where(repositoryAccessPredicate(caller.email, (useRuntimeConfig().openapeSp as { clientId: string }).clientId)).orderBy(desc(repos.createdAt))
})
