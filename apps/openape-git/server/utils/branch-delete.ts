import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { pulls } from '../database/schema'
import { protectionsFor } from './branch-protection'

const run = promisify(execFile)

export interface BranchDeletionContext {
  branch: string
  defaultBranch: string
  protectedBranches: string[]
  openPullRefs: string[]
}

const shortRef = (ref: string) => ref.replace(/^refs\/heads\//, '')

/** Why this branch must stay, or null when it may be deleted. */
export function branchDeletionRefusal(context: BranchDeletionContext): string | null {
  if (context.branch === context.defaultBranch) return 'the default branch cannot be deleted'
  if (context.protectedBranches.includes(context.branch)) return `protected branch ${context.branch} cannot be deleted`
  if (context.openPullRefs.map(shortRef).includes(context.branch)) return `branch ${context.branch} is used by an open pull request`
  return null
}

export async function branchRefusal(repo: { id: string, defaultBranch: string }, branch: string): Promise<string | null> {
  const [protections, openPulls] = await Promise.all([
    protectionsFor(repo.id),
    useDb().select({ sourceRef: pulls.sourceRef, targetRef: pulls.targetRef }).from(pulls).where(and(eq(pulls.repoId, repo.id), eq(pulls.state, 'open'))),
  ])
  return branchDeletionRefusal({
    branch,
    defaultBranch: repo.defaultBranch,
    protectedBranches: protections.filter(p => p.enabled).map(p => p.branch),
    openPullRefs: openPulls.flatMap(p => [p.sourceRef, p.targetRef]),
  })
}

/** Compare-and-swap delete: git refuses when the branch moved away from `expectedSha`. */
export async function deleteBranchRef(dir: string, branch: string, expectedSha: string): Promise<void> {
  await run('git', ['-C', dir, 'update-ref', '-d', `refs/heads/${branch}`, expectedSha])
}
