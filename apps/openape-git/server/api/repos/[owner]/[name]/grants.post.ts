import { createDelegation } from '@openape/grants'
import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { repoScope } from '../../../../utils/git-access'
import { useGrantStore } from '../../../../utils/grant-store'
import { findRepo } from '../../../../utils/repos'

const ACCESS_LEVELS = ['read', 'write', 'admin'] as const

/**
 * POST /api/repos/:owner/:name/grants { delegate, access, duration? } —
 * the owner delegates git access on one repo. Scopes carry the level
 * (git:read|write|admin) and the resource (repo:<owner>/<name>).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  // Mirrors the IdP's act-enforcement: only humans create delegations.
  if (caller.act !== 'human')
    throw createError({ statusCode: 403, statusMessage: 'only humans can issue grants' })

  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const body = await readBody<{ delegate?: string, access?: string, duration?: number }>(event)
  const delegate = body?.delegate?.trim().toLowerCase() ?? ''
  const access = body?.access as typeof ACCESS_LEVELS[number]
  if (!delegate || !delegate.includes('@') || delegate.length > 255)
    throw createError({ statusCode: 400, statusMessage: 'delegate must be an email address' })
  if (!ACCESS_LEVELS.includes(access))
    throw createError({ statusCode: 400, statusMessage: 'access must be read, write or admin' })
  const duration = body?.duration
  if (duration !== undefined && (!Number.isInteger(duration) || duration <= 0))
    throw createError({ statusCode: 400, statusMessage: 'duration must be a positive integer (seconds)' })

  const config = useRuntimeConfig()
  const clientId = (config.openapeSp as { clientId?: string })?.clientId ?? 'repos.openape.ai'
  return createDelegation({
    delegator: caller.email,
    delegate,
    audience: clientId,
    scopes: [`git:${access}`, repoScope(owner, name)],
    grant_type: duration ? 'timed' : 'always',
    duration,
  }, useGrantStore())
})
