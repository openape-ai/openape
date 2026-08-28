import { asc, eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../../../../../database/drizzle'
import { pullComments } from '../../../../../../database/schema'
import { parsePatch } from '../../../../../../utils/git-parse'
import { listPushedCommits, resolveCommit } from '../../../../../../utils/git-read'
import { diffPatch, mergePreview } from '../../../../../../utils/git-merge'
import { requirePull } from '../../../../../../utils/pulls'
import { repoDiskPath } from '../../../../../../utils/repos'
import { accessAllows } from '../../../../../../utils/git-access'

// A big diff is a review problem, not a rendering problem — cap it and say so.
const MAX_PATCH_BYTES = 1024 * 1024
const MAX_COMMITS = 100

/**
 * GET /api/repos/:owner/:name/pulls/:number — the PR as git sees it right
 * now: the tips of both refs, the commits the source adds, the three-dot
 * diff, whether it still merges cleanly, plus the review metadata.
 */
export default defineEventHandler(async (event) => {
  const { repo, pull, access } = await requirePull(event, 'read')
  const dir = repoDiskPath(repo.owner, repo.name)

  const [sourceSha, targetSha] = await Promise.all([
    resolveCommit(dir, pull.sourceRef),
    resolveCommit(dir, pull.targetRef),
  ])

  const comments = await useDb().select().from(pullComments).where(eq(pullComments.pullId, pull.id)).orderBy(asc(pullComments.createdAt))

  // A merged PR keeps its ref pair, but the branches may be gone or moved on:
  // only an open PR with both tips present has a live diff to compute.
  const live = pull.state === 'open' && sourceSha && targetSha
  const [diff, merge, commits] = live
    ? await Promise.all([
        diffPatch(dir, targetSha, sourceSha, MAX_PATCH_BYTES),
        mergePreview(dir, targetSha, sourceSha),
        listPushedCommits(dir, targetSha, sourceSha, MAX_COMMITS),
      ])
    : [{ patch: '', truncated: false }, { mergeable: false, tree: null, conflicts: [] }, []]

  return {
    pull: {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      sourceRef: pull.sourceRef,
      targetRef: pull.targetRef,
      state: pull.state,
      authorEmail: pull.authorEmail,
      mergeSha: pull.mergeSha,
      createdAt: pull.createdAt,
      mergedAt: pull.mergedAt,
    },
    sourceSha,
    targetSha,
    commits,
    files: parsePatch(diff.patch),
    truncated: diff.truncated,
    mergeable: merge.mergeable,
    conflicts: merge.conflicts,
    canMerge: pull.state === 'open' && accessAllows(access, 'write'),
    comments: comments.map(({ pullId: _pullId, ...comment }) => comment),
  }
})
