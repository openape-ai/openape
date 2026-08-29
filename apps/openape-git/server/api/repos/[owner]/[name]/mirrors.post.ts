import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { mirrors } from '../../../../database/schema'
import { findRepo } from '../../../../utils/repos'

/**
 * POST /api/repos/:owner/:name/mirrors { url, username, token } — replicate
 * every push of this repo to another forge (M8). Owner only.
 *
 * The token is a write credential for a FOREIGN system, so it is never echoed
 * back: the response carries the mirror without it. Scope it to the one repo
 * on the far side — this row is not a place for a broad token.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''

  const repo = await findRepo(owner, name)
  if (!repo || repo.ownerEmail !== caller.email)
    throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  const body = await readBody<{ url?: string, username?: string, token?: string }>(event)
  const url = body?.url?.trim() ?? ''
  const username = body?.username?.trim() ?? ''
  const token = body?.token?.trim() ?? ''

  if (!/^https:\/\//.test(url))
    throw createError({ statusCode: 400, statusMessage: 'url must be https' })
  if (!username || !token)
    throw createError({ statusCode: 400, statusMessage: 'username and token required' })

  const mirror = {
    id: ulid(),
    repoId: repo.id,
    url,
    username,
    token,
    enabled: 1,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await useDb().insert(mirrors).values(mirror)

  const { token: _token, ...safe } = mirror
  return safe
})
