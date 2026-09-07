import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { protectionEvents } from '../../../../database/schema'
import { protectionsFor } from '../../../../utils/branch-protection'
import { requireRepoRead } from '../../../../utils/repo-access'

export default defineEventHandler(async (event) => {
  const repo = await requireRepoRead(event, getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'name') ?? '')
  return { policies: await protectionsFor(repo.id), events: await useDb().select().from(protectionEvents).where(eq(protectionEvents.repoId, repo.id)).orderBy(desc(protectionEvents.createdAt)).limit(30) }
})
