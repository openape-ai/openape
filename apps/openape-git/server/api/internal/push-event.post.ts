import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { webhookDeliveries, webhooks } from '../../database/schema'
import { listPushedCommits } from '../../utils/git-read'
import { isInternalToken } from '../../utils/internal-token'
import { findRepo, repoDiskPath } from '../../utils/repos'
import { deliver } from '../../utils/webhooks'

const MAX_COMMITS_PER_EVENT = 20
const ZERO_SHA = /^0+$/

interface PushEventBody {
  owner?: string
  name?: string
  updates?: { before: string, after: string, ref: string }[]
  pusher?: { email?: string, act?: string, delegator?: string }
}

/**
 * POST /api/internal/push-event — the post-receive hook reporting a push.
 * Loopback only: authorized by the per-process internal token the transport
 * hands down to the hook, never by a session or a grant.
 */
export default defineEventHandler(async (event) => {
  if (!isInternalToken(getHeader(event, 'x-ape-internal-token')))
    throw createError({ statusCode: 401, statusMessage: 'internal token required' })

  const body = await readBody<PushEventBody>(event)
  const repo = await findRepo(body?.owner ?? '', body?.name ?? '')
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const db = useDb()
  const subscriptions = await db.select().from(webhooks).where(eq(webhooks.repoId, repo.id))
  if (subscriptions.length === 0) return { delivered: 0 }

  const dir = repoDiskPath(repo.owner, repo.name)
  const pusher = {
    email: body?.pusher?.email ?? '',
    act: body?.pusher?.act ?? 'agent',
    ...(body?.pusher?.delegator ? { delegator: body.pusher.delegator } : {}),
  }

  let delivered = 0
  for (const update of body?.updates ?? []) {
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
  return { delivered }
})
