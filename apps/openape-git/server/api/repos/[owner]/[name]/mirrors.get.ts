import { desc, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { mirrorPushes, mirrors } from '../../../../database/schema'
import { findRepo } from '../../../../utils/repos'

const RECENT_PUSHES = 20

/**
 * GET /api/repos/:owner/:name/mirrors — the configured mirrors and their most
 * recent push attempts. Owner only. Tokens are not included.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''

  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const db = useDb()
  const configured = await db.select().from(mirrors).where(eq(mirrors.repoId, repo.id))
  const pushes = await db.select().from(mirrorPushes).where(eq(mirrorPushes.repoId, repo.id)).orderBy(desc(mirrorPushes.createdAt)).limit(RECENT_PUSHES)

  return {
    mirrors: configured.map(({ token: _token, ...m }) => m),
    pushes,
  }
})
