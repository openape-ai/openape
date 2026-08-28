import { createError, defineEventHandler, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../../../database/drizzle'
import { pullComments } from '../../../../../../database/schema'
import { isValidTreePath } from '../../../../../../utils/git-parse'
import { requirePull } from '../../../../../../utils/pulls'

const MAX_COMMENT = 20_000

/**
 * POST /api/repos/:owner/:name/pulls/:number/comments { body, path?, line? }
 * A comment with path+line is anchored to a diff line; without them it is a
 * comment on the PR itself. Anyone who can read the repo can review it.
 */
export default defineEventHandler(async (event) => {
  const { pull, caller } = await requirePull(event, 'read')

  const input = await readBody<{ body?: string, path?: string, line?: number }>(event)
  const body = (input?.body ?? '').trim()
  if (!body || body.length > MAX_COMMENT)
    throw createError({ statusCode: 400, statusMessage: 'body required (max 20000 chars)' })

  const path = input?.path?.trim() || null
  if (path && !isValidTreePath(path))
    throw createError({ statusCode: 400, statusMessage: 'invalid path' })
  const line = path && Number.isInteger(input?.line) && input!.line! > 0 ? input!.line! : null

  const comment = {
    id: ulid(),
    pullId: pull.id,
    authorEmail: caller.email,
    body,
    path,
    line,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await useDb().insert(pullComments).values(comment)
  return { id: comment.id }
})
