import { eq } from 'drizzle-orm'
import { createError, defineEventHandler } from 'h3'
import { useDb } from '../../../../../../database/drizzle'
import { pulls } from '../../../../../../database/schema'
import { createMergeCommit, mergeBase, mergeMessage, mergePreview } from '../../../../../../utils/git-merge'
import { resolveCommit } from '../../../../../../utils/git-read'
import { requirePull } from '../../../../../../utils/pulls'
import { appendPushRecord } from '../../../../../../utils/push-log'
import { dispatchPushEvent } from '../../../../../../utils/push-dispatch'
import { repoDiskPath } from '../../../../../../utils/repos'

/**
 * POST /api/repos/:owner/:name/pulls/:number/merge — create the merge commit
 * and move the target branch. The commit carries the merging identity, and
 * the branch update is a compare-and-swap against the tip we merged from, so
 * a push that lands in between makes the merge fail instead of clobbering it.
 */
export default defineEventHandler(async (event) => {
  const { repo, pull, caller } = await requirePull(event, 'write')
  if (pull.state !== 'open')
    throw createError({ statusCode: 409, statusMessage: `pull request is ${pull.state}` })

  const dir = repoDiskPath(repo.owner, repo.name)
  const targetRef = `refs/heads/${pull.targetRef}`
  const [sourceSha, targetSha] = await Promise.all([
    resolveCommit(dir, pull.sourceRef),
    resolveCommit(dir, targetRef),
  ])
  if (!sourceSha)
    throw createError({ statusCode: 409, statusMessage: `source ref is gone: ${pull.sourceRef}` })
  if (!targetSha)
    throw createError({ statusCode: 409, statusMessage: `target is not a branch: ${pull.targetRef}` })
  if (await mergeBase(dir, targetSha, sourceSha) === sourceSha)
    throw createError({ statusCode: 409, statusMessage: 'nothing to merge: target already contains source' })

  const preview = await mergePreview(dir, targetSha, sourceSha)
  if (!preview.mergeable || !preview.tree) {
    throw createError({
      statusCode: 409,
      statusMessage: preview.conflicts.length > 0
        ? `merge conflicts in: ${preview.conflicts.join(', ')}`
        : 'refs cannot be merged',
    })
  }

  const sha = await createMergeCommit(dir, {
    tree: preview.tree,
    target: targetSha,
    source: sourceSha,
    targetRef,
    expectedTarget: targetSha,
    message: mergeMessage(pull.number, pull.title, pull.sourceRef, pull.targetRef),
    identity: { name: caller.email.split('@')[0] ?? caller.email, email: caller.email },
  })

  const now = Math.floor(Date.now() / 1000)
  await appendPushRecord(dir, sha, { email: caller.email, act: caller.act, ts: now })
  await useDb().update(pulls).set({ state: 'merged', mergeSha: sha, mergedAt: now }).where(eq(pulls.id, pull.id))

  // A merge moves a branch: CI consumers hear about it like any other push.
  await dispatchPushEvent(repo, [{ ref: targetRef, before: targetSha, after: sha }], {
    email: caller.email,
    act: caller.act,
  })

  return { sha }
})
