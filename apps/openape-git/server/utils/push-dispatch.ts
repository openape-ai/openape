import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { mirrorPushes, mirrors, webhookDeliveries, webhooks } from '../database/schema'
import { pushRefToMirror, shouldMirrorRef } from './mirror'
import { listPushedCommits } from './git-read'
import { repoDiskPath } from './repos'
import { deliver } from './webhooks'

// Fan-out of a ref update to this repo's webhook subscribers. Both producers
// use it: the post-receive hook (via /api/internal/push-event) and a merge
// performed in the UI — a merge moves a branch, so a CI consumer must hear
// about it exactly like a push.

const MAX_COMMITS_PER_EVENT = 20
const ZERO_SHA = /^0+$/

export interface RefUpdate {
  ref: string
  before: string
  after: string
}

export interface Pusher {
  email: string
  act: string
  delegator?: string
}

interface RepoRef {
  id: string
  owner: string
  name: string
}

/**
 * Replicates the updated refs to this repo's mirrors (M8). Runs without
 * `--force`: the far side is written to directly as well, so a diverging
 * history fails visibly in `mirror_pushes` instead of being overwritten.
 *
 * A mirror that is down must never fail the push that triggered it — the
 * commits are already accepted at this point. Every attempt is recorded.
 */
export async function dispatchMirrorPush(repo: RepoRef, updates: RefUpdate[]): Promise<void> {
  const db = useDb()
  const targets = await db.select().from(mirrors).where(eq(mirrors.repoId, repo.id))
  const active = targets.filter(m => m.enabled)
  if (active.length === 0) return

  const dir = repoDiskPath(repo.owner, repo.name)
  for (const update of updates) {
    if (!shouldMirrorRef(update.ref)) continue
    for (const mirror of active) {
      const result = await pushRefToMirror(dir, mirror, update.ref)
      await db.insert(mirrorPushes).values({
        id: ulid(),
        mirrorId: mirror.id,
        repoId: repo.id,
        ref: update.ref,
        sha: update.after,
        ok: result.ok ? 1 : 0,
        error: result.error ?? null,
        durationMs: result.durationMs,
        createdAt: Math.floor(Date.now() / 1000),
      })
      const outcome = result.ok ? 'ok' : `FAILED: ${result.error?.split('\n')[0]}`
      console.log(`[ape-git] mirror ${mirror.url} ${update.ref} ${outcome} (${result.durationMs}ms)`)
    }
  }
}

export async function dispatchPushEvent(repo: RepoRef, updates: RefUpdate[], pusher: Pusher): Promise<number> {
  const db = useDb()
  const subscriptions = await db.select().from(webhooks).where(eq(webhooks.repoId, repo.id))
  if (subscriptions.length === 0) return 0

  const dir = repoDiskPath(repo.owner, repo.name)
  let delivered = 0
  for (const update of updates) {
    const commits = ZERO_SHA.test(update.after)
      ? []
      : await listPushedCommits(dir, update.before, update.after, MAX_COMMITS_PER_EVENT)

    for (const subscription of subscriptions) {
      const deliveryId = ulid()
      const result = await deliver(subscription.url, subscription.secret, {
        event: 'push',
        repo: `${repo.owner}/${repo.name}`,
        ref: update.ref,
        before: update.before,
        after: update.after,
        commits: commits.map(c => ({ sha: c.sha, subject: c.subject, author: c.author, email: c.email })),
        pusher,
        deliveredAt: Math.floor(Date.now() / 1000),
      }, deliveryId)

      await db.insert(webhookDeliveries).values({
        id: deliveryId,
        webhookId: subscription.id,
        repoId: repo.id,
        event: 'push',
        ref: update.ref,
        statusCode: result.statusCode,
        error: result.error,
        durationMs: result.durationMs,
        createdAt: Math.floor(Date.now() / 1000),
      })
      console.log(`[ape-git] webhook ${deliveryId} -> ${subscription.url} ${result.statusCode ?? result.error} (${result.durationMs}ms)`)
      delivered++
    }
  }
  return delivered
}
