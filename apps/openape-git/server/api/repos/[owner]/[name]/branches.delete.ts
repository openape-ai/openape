import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { branchRefusal, deleteBranchRef } from '../../../../utils/branch-delete'
import { listBranches } from '../../../../utils/git-read'
import { dispatchMirrorPush, dispatchPushEvent } from '../../../../utils/push-dispatch'
import { requireRepoAccess } from '../../../../utils/repo-access'
import { repoDiskPath } from '../../../../utils/repos'

const ZERO_SHA = '0'.repeat(40)

/**
 * DELETE /api/repos/:owner/:name/branches — body `{ branch, expectedSha }`.
 * The name travels in the body because branch names contain slashes. The
 * delete is a compare-and-swap against the tip the caller saw, and it fans
 * out like a push so mirrors and webhook consumers see the branch go.
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const { repo, caller } = await requireRepoAccess(event, owner, name, 'write')

  const body = await readBody<{ branch?: unknown, expectedSha?: unknown }>(event)
  if (typeof body?.branch !== 'string' || typeof body.expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(body.expectedSha))
    throw createError({ statusCode: 400, statusMessage: 'branch and expectedSha (40 hex) required' })

  const dir = repoDiskPath(owner, name)
  // Exact match against the existing branches: no rev-parse expressions.
  const branch = (await listBranches(dir)).find(b => b.name === body.branch)
  if (!branch) throw createError({ statusCode: 404, statusMessage: 'branch not found' })
  if (branch.sha !== body.expectedSha)
    throw createError({ statusCode: 409, statusMessage: `branch moved: now at ${branch.sha}` })

  const refusal = await branchRefusal(repo, branch.name)
  if (refusal) throw createError({ statusCode: 409, statusMessage: refusal })

  try {
    await deleteBranchRef(dir, branch.name, branch.sha)
  }
  catch {
    throw createError({ statusCode: 409, statusMessage: 'branch moved while deleting' })
  }

  const ref = `refs/heads/${branch.name}`
  console.log(`[ape-git] ${caller.email} deleted ${owner}/${name} ${ref} at ${branch.sha}`)
  const update = { ref, before: branch.sha, after: ZERO_SHA }
  void dispatchMirrorPush(repo, [update])
    .catch(err => console.error('[ape-git] branch delete mirror dispatch failed', err))
  await dispatchPushEvent(repo, [update], { email: caller.email, act: caller.act })

  return { ref, sha: branch.sha }
})
