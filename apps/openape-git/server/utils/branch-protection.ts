import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useDb } from '../database/drizzle'
import { branchProtections, mirrors } from '../database/schema'
import { checkBlockers, forgejoApiBase, normalizeForgejoChecks } from './branch-checks'

export async function protectionsFor(repoId: string) {
  return useDb().select().from(branchProtections).where(eq(branchProtections.repoId, repoId))
}

export async function externalChecks(repoId: string, sha: string, mirrorId: string) {
  const db = useDb()
  const [mirror] = await db.select().from(mirrors).where(and(eq(mirrors.id, mirrorId), eq(mirrors.repoId, repoId)))
  if (!mirror?.enabled) throw new Error('Configured CI mirror is unavailable')
  const api = forgejoApiBase(mirror.url)
  const response = await fetch(`${api}/commits/${sha}/status?per_page=100`, {
    headers: { authorization: `token ${mirror.token}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`CI provider returned HTTP ${response.status}`)
  return normalizeForgejoChecks(await response.json(), sha, new URL(mirror.url).origin)
}

export async function branchGate(repoId: string, branch: string, sha: string) {
  const policy = (await protectionsFor(repoId)).find(p => p.enabled && p.branch === branch.replace(/^refs\/heads\//, ''))
  if (!policy) return { protected: false, blockers: [] as string[], checks: [] as Awaited<ReturnType<typeof externalChecks>>, policy: null }
  try {
    const checks = await externalChecks(repoId, sha, policy.mirrorId)
    return { protected: true, blockers: checkBlockers(policy.contexts, checks, sha), checks, policy }
  }
  catch (error) {
    return { protected: true, blockers: [(error as Error).message], checks: [] as Awaited<ReturnType<typeof externalChecks>>, policy }
  }
}

export async function requireBranchGate(repoId: string, branch: string, sha: string) {
  const gate = await branchGate(repoId, branch, sha)
  if (gate.blockers.length) throw createError({ statusCode: 409, statusMessage: `Required checks block merge: ${gate.blockers.join('; ')}` })
  return gate
}
