import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../../database/drizzle'
import { commitStatuses } from '../../../../../database/schema'
import { isValidSha } from '../../../../../utils/git-parse'
import { requireRepoRead } from '../../../../../utils/repo-access'

/**
 * GET /api/repos/:owner/:name/statuses/:sha — CI results for one commit,
 * including the run log. Behind the repo's read access: a CI log is repo
 * content, not public data.
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const sha = getRouterParam(event, 'sha') ?? ''
  if (!isValidSha(sha))
    throw createError({ statusCode: 400, statusMessage: 'sha must be a full commit sha' })

  const repo = await requireRepoRead(event, owner, name)
  const rows = await useDb().select().from(commitStatuses).where(and(eq(commitStatuses.repoId, repo.id), eq(commitStatuses.sha, sha)))
  return { sha, statuses: rows }
})
