import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { webhooks } from '../../../../database/schema'
import { findRepo } from '../../../../utils/repos'
import { newWebhookSecret } from '../../../../utils/webhooks'

/**
 * POST /api/repos/:owner/:name/webhooks { url } — subscribe a consumer to
 * this repo's push events. Owner only; the generated secret is returned once
 * and only shown here, like any other credential.
 *
 * ponytail: no SSRF filter on the target URL. Only the authenticated repo
 * owner can subscribe, and a delivery surfaces nothing but its status code —
 * so the reach of a hostile URL is a blind POST. Add an address filter if
 * webhooks ever become settable by a delegate.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''

  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const url = (await readBody<{ url?: string }>(event))?.url?.trim() ?? ''
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'url must be an absolute http(s) URL' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw createError({ statusCode: 400, statusMessage: 'url must be an absolute http(s) URL' })

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
