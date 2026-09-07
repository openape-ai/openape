import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { branchProtections, mirrors, protectionEvents } from '../../../../database/schema'
import { forgejoApiBase } from '../../../../utils/branch-checks'
import { isValidRef } from '../../../../utils/git-parse'
import { findRepo } from '../../../../utils/repos'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  if (caller.act !== 'human') throw createError({ statusCode: 403, statusMessage: 'only the human repository owner can change protection' })
  const repo = await findRepo(getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'name') ?? '')
  if (!repo || repo.ownerEmail !== caller.email) throw createError({ statusCode: 404, statusMessage: 'repo not found' })
  const body = await readBody<{ branch?: string, mirrorId?: string, contexts?: string[], enabled?: boolean, reason?: string }>(event)
  const branch = body?.branch ?? ''
  if (!isValidRef(branch) || branch.startsWith('refs/')) throw createError({ statusCode: 400, statusMessage: 'branch name required, without refs/heads/' })
  if (!Array.isArray(body.contexts) || !body.contexts.length || body.contexts.length > 20 || body.contexts.some(c => typeof c !== 'string' || !c.trim() || c.length > 100))
    throw createError({ statusCode: 400, statusMessage: '1–20 required check contexts expected' })
  if (typeof body.enabled !== 'boolean' || typeof body.reason !== 'string' || body.reason.trim().length < 5)
    throw createError({ statusCode: 400, statusMessage: 'enabled and an audit reason are required' })
  const db = useDb()
  const [mirror] = await db.select().from(mirrors).where(and(eq(mirrors.id, body.mirrorId ?? ''), eq(mirrors.repoId, repo.id)))
  if (!mirror?.enabled) throw createError({ statusCode: 400, statusMessage: 'enabled repository mirror required' })
  try { forgejoApiBase(mirror.url) }
  catch { throw createError({ statusCode: 400, statusMessage: 'mirror must point to an HTTPS Forgejo repository' }) }
  const row = { repoId: repo.id, branch, mirrorId: mirror.id, contexts: [...new Set(body.contexts.map(c => c.trim()))], enabled: body.enabled ? 1 : 0, updatedAt: Math.floor(Date.now() / 1000), updatedBy: caller.email }
  await db.transaction(async (tx) => {
    await tx.insert(protectionEvents).values({ id: ulid(), repoId: repo.id, branch, actor: caller.email, reason: body.reason!.trim().slice(0, 2000), configuration: JSON.stringify(row), createdAt: row.updatedAt })
    await tx.insert(branchProtections).values(row).onConflictDoUpdate({ target: [branchProtections.repoId, branchProtections.branch], set: row })
  })
  return row
})
