import { desc, eq } from 'drizzle-orm'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { webhookDeliveries, webhooks } from '../../../../database/schema'
import { accessFromScopes } from '../../../../utils/git-access'
import { useGrantStore } from '../../../../utils/grant-store'
import { findRepo } from '../../../../utils/repos'

const RECENT_DELIVERIES = 10

/**
 * GET /api/repos/:owner/:name — repo details plus its access grants and
 * webhook subscriptions. Owner only: grants and webhook endpoints are
 * authorization state, not public metadata. Secrets are never returned —
 * they are shown once at creation.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''

  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const delegated = await useGrantStore().findByDelegator(caller.email)
  const grants = delegated
    .map(grant => ({
      id: grant.id,
      delegate: grant.request.delegate ?? '',
      access: accessFromScopes(grant.request.scopes, owner, name),
      status: grant.status,
      createdAt: grant.created_at,
      expiresAt: grant.expires_at ?? null,
    }))
    .filter(grant => grant.access !== null)

  const db = useDb()
  const [hooks, deliveries] = await Promise.all([
    db.select({ id: webhooks.id, url: webhooks.url, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(eq(webhooks.repoId, repo.id)),
    db.select().from(webhookDeliveries).where(eq(webhookDeliveries.repoId, repo.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(RECENT_DELIVERIES),
  ])

  return { ...repo, grants, webhooks: hooks, deliveries }
})
