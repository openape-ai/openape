import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../../database/drizzle'
import { pulls } from '../../../../../database/schema'
import { requireRepoRead } from '../../../../../utils/repo-access'

/** GET /api/repos/:owner/:name/pulls — every PR of the repo, newest first. */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await requireRepoRead(event, owner, name)

  const rows = await useDb().select().from(pulls).where(eq(pulls.repoId, repo.id)).orderBy(desc(pulls.number))
  return { pulls: rows.map(({ repoId: _repoId, id: _id, ...pull }) => pull) }
})
