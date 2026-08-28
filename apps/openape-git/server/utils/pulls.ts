import type { H3Event } from 'h3'
import type { GitAccess } from './git-access'
import { and, desc, eq } from 'drizzle-orm'
import { createError, getRouterParam } from 'h3'
import { useDb } from '../database/drizzle'
import { pulls } from '../database/schema'
import { requireRepoAccess } from './repo-access'

/** Per-repo PR number, like every forge. Races lose to the unique index. */
export async function nextPullNumber(repoId: string): Promise<number> {
  const rows = await useDb().select({ number: pulls.number }).from(pulls).where(eq(pulls.repoId, repoId)).orderBy(desc(pulls.number)).limit(1)
  return (rows[0]?.number ?? 0) + 1
}

export async function findPull(repoId: string, number: number) {
  const rows = await useDb().select().from(pulls).where(and(eq(pulls.repoId, repoId), eq(pulls.number, number))).limit(1)
  return rows[0] ?? null
}

/**
 * Resolve `/repos/:owner/:name/pulls/:number` with the access level the
 * operation needs. Read for viewing and commenting, write for merging.
 */
export async function requirePull(event: H3Event, required: GitAccess) {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const number = Number.parseInt(getRouterParam(event, 'number') ?? '')
  if (!Number.isInteger(number) || number < 1)
    throw createError({ statusCode: 400, statusMessage: 'invalid pull number' })

  const { repo, caller, access } = await requireRepoAccess(event, owner, name, required)
  const pull = await findPull(repo.id, number)
  if (!pull) throw createError({ statusCode: 404, statusMessage: 'pull request not found' })
  return { repo, caller, access, pull }
}
