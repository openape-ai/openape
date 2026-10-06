import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../../database/drizzle'
import { commitStatuses } from '../../../../../database/schema'
import { isValidSha } from '../../../../../utils/git-parse'
import { externalChecks, protectionsFor } from '../../../../../utils/branch-protection'
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
  const providers = [...new Set((await protectionsFor(repo.id)).map(p => p.mirrorId))]
  const external = [] as Awaited<ReturnType<typeof externalChecks>>
  const errors: string[] = []
  for (const id of providers) {
    try { external.push(...await externalChecks(repo.id, sha, id)) }
    catch (error) { errors.push((error as Error).message) }
  }
  const combined = external.map((check) => {
    const report = rows.find(r => r.context === check.context && r.state === check.state && r.targetUrl && check.targetUrl?.startsWith(`${r.targetUrl}/jobs/`))
    return { ...check, log: report?.log ?? null }
  })
  return { sha, statuses: [...rows.filter(r => !external.some(c => c.context === r.context)).map(r => ({ ...r, provider: 'webhook' })), ...combined], providerErrors: errors }
})
