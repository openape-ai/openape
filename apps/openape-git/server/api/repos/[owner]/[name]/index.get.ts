import { createError, defineEventHandler, getRouterParam } from 'h3'
import { accessFromScopes } from '../../../../utils/git-access'
import { useGrantStore } from '../../../../utils/grant-store'
import { findRepo } from '../../../../utils/repos'

/**
 * GET /api/repos/:owner/:name — repo details plus its access grants.
 * Owner only: grants are authorization state, not public metadata.
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

  return { ...repo, grants }
})
