import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { webhooks } from '../../../../database/schema'
import { findRepo } from '../../../../utils/repos'
import { newWebhookSecret, webhookTargetError } from '../../../../utils/webhooks'

/**
 * POST /api/repos/:owner/:name/webhooks { url } — subscribe a consumer to
 * this repo's push events. Owner only; the generated secret is returned once
 * and only shown here, like any other credential.
 *
 * The target check (see webhookTargetError) is deliberately narrow: private
 * addresses stay allowed because the reference consumer runs on the compose
 * network. What keeps a hostile URL cheap is that only the authenticated
 * owner can subscribe and a delivery surfaces nothing but its status code —
 * revisit if webhooks ever become settable by a delegate.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''

  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const url = (await readBody<{ url?: string }>(event))?.url?.trim() ?? ''
  const targetError = webhookTargetError(url)
  if (targetError)
    throw createError({ statusCode: 400, statusMessage: targetError })

  const hook = {
    id: ulid(),
    repoId: repo.id,
    url,
    secret: newWebhookSecret(),
    createdAt: Math.floor(Date.now() / 1000),
  }
  await useDb().insert(webhooks).values(hook)
  return hook
})
