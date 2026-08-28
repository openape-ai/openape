import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { repos } from '../../database/schema'
import { isValidOwner, isValidRepoName } from '../../utils/git-access'
import { createBareRepo } from '../../utils/repos'

/**
 * POST /api/repos { owner, name } — register a repo and create the bare repo
 * on disk. The owner namespace is first-come-first-served and sticks to the
 * creating identity.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ owner?: string, name?: string }>(event)

  const owner = body?.owner?.trim().toLowerCase() ?? ''
  const name = body?.name?.trim() ?? ''
  if (!isValidOwner(owner))
    throw createError({ statusCode: 400, statusMessage: 'invalid owner (a-z, 0-9, dashes, max 64)' })
  if (!isValidRepoName(name))
    throw createError({ statusCode: 400, statusMessage: 'invalid repo name (a-z, 0-9, ._-, max 100, no .git suffix)' })

  const db = useDb()
  const namespace = await db.select().from(repos).where(eq(repos.owner, owner)).limit(1)
  if (namespace[0] && namespace[0].ownerEmail !== caller.email)
    throw createError({ statusCode: 403, statusMessage: `owner namespace '${owner}' belongs to someone else` })
  const existing = await db.select().from(repos).where(and(eq(repos.owner, owner), eq(repos.name, name))).limit(1)
  if (existing[0])
    throw createError({ statusCode: 409, statusMessage: `repo ${owner}/${name} already exists` })

  const repo = {
    id: ulid(),
    owner,
    name,
    ownerEmail: caller.email,
    defaultBranch: 'main',
    createdAt: Math.floor(Date.now() / 1000),
  }
  await createBareRepo(owner, name)
  await db.insert(repos).values(repo)
  return repo
})
