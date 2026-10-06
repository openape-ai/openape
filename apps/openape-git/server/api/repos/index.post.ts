import { and, eq } from 'drizzle-orm'
import { createError, defineEventHandler, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { repos } from '../../database/schema'
import { isValidOwner, isValidRepoName } from '../../utils/git-access'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createBareRepo, externalCodeSource } from '../../utils/repos'

/**
 * POST /api/repos { owner, name } — register a repo and create the bare repo
 * on disk. The owner namespace is first-come-first-served and sticks to the
 * creating identity.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ owner?: string, name?: string, issueHomeOnly?: boolean, codeSourceUrl?: string }>(event)

  const owner = body?.owner?.trim().toLowerCase() ?? ''
  const name = body?.name?.trim() ?? ''
  if (!isValidOwner(owner))
    throw createError({ statusCode: 400, statusMessage: 'invalid owner (a-z, 0-9, dashes, max 64)' })
  if (!isValidRepoName(name))
    throw createError({ statusCode: 400, statusMessage: 'invalid repo name (a-z, 0-9, ._-, max 100, no .git suffix)' })

  if (body.issueHomeOnly !== undefined && typeof body.issueHomeOnly !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'issueHomeOnly must be boolean' })
  const issueHomeOnly = body.issueHomeOnly === true
  if (issueHomeOnly && !useRuntimeConfig().public.issuesEnabled) throw createError({ statusCode: 404, statusMessage: 'Issue tracking is not enabled' })
  if (!issueHomeOnly && body.codeSourceUrl !== undefined) throw createError({ statusCode: 400, statusMessage: 'External code sources require an issue-only home' })
  const codeSourceUrl = issueHomeOnly ? externalCodeSource(body.codeSourceUrl) : null

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
    issueHomeOnly: issueHomeOnly ? 1 : 0,
    codeSourceUrl,
    createdAt: Math.floor(Date.now() / 1000),
  }
  if (!issueHomeOnly) await createBareRepo(owner, name)
  await db.insert(repos).values(repo)
  return repo
})
