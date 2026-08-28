import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { createError, getHeader } from 'h3'
import { useDb } from '../database/drizzle'
import { webhooks } from '../database/schema'
import { findRepo } from './repos'
import { SIGNATURE_HEADER, verifySignature } from './webhooks'

/**
 * Authorize a consumer request by the shared secret of one of the repo's
 * webhooks. This is what lets an unattended CI consumer report back and fetch
 * the pushed tree without holding a DDISA token that expires — its reach is
 * exactly the repos it is subscribed to. Unknown repo and bad signature both
 * answer the same way as elsewhere: no existence leak.
 */
export async function repoBySignedRequest(event: H3Event, owner: string, name: string, payload: string) {
  const repo = await findRepo(owner, name)
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const signature = getHeader(event, SIGNATURE_HEADER)
  const subscriptions = await useDb().select().from(webhooks).where(eq(webhooks.repoId, repo.id))
  if (!subscriptions.some(hook => verifySignature(payload, hook.secret, signature)))
    throw createError({ statusCode: 401, statusMessage: 'invalid webhook signature' })

  return repo
}
