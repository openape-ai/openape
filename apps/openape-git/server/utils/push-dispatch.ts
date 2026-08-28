import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { webhookDeliveries, webhooks } from '../database/schema'
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
