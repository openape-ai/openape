import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../../database/drizzle'
import { pulls } from '../../../../../database/schema'
import { isValidRef } from '../../../../../utils/git-parse'
import { resolveCommit } from '../../../../../utils/git-read'
import { requireRepoAccess } from '../../../../../utils/repo-access'
import { nextPullNumber } from '../../../../../utils/pulls'
import { repoDiskPath } from '../../../../../utils/repos'

const MAX_TITLE = 200
const MAX_BODY = 20_000

/**
 * POST /api/repos/:owner/:name/pulls { title, body, source, target }
 * Opening a PR proposes a merge into a branch, so it needs write access —
 * the same level the eventual merge needs.
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const { repo, caller } = await requireRepoAccess(event, owner, name, 'write')

  const body = await readBody<{ title?: string, body?: string, source?: string, target?: string }>(event)
  const title = (body?.title ?? '').trim()
  const source = (body?.source ?? '').trim()
  const target = (body?.target ?? repo.defaultBranch).trim()
  const description = (body?.body ?? '').trim()

  if (!title || title.length > MAX_TITLE)
    throw createError({ statusCode: 400, statusMessage: 'title required (max 200 chars)' })
  if (description.length > MAX_BODY)
    throw createError({ statusCode: 400, statusMessage: 'body too long' })
  if (!isValidRef(source) || !isValidRef(target))
    throw createError({ statusCode: 400, statusMessage: 'invalid ref' })
  if (source === target)
    throw createError({ statusCode: 400, statusMessage: 'source and target must differ' })

  const dir = repoDiskPath(repo.owner, repo.name)
  for (const ref of [source, target]) {
    if (!await resolveCommit(dir, ref))
      throw createError({ statusCode: 400, statusMessage: `ref not found: ${ref}` })
  }

  const pull = {
    id: ulid(),
    repoId: repo.id,
    number: await nextPullNumber(repo.id),
    title,
    body: description || null,
    sourceRef: source,
    targetRef: target,
    state: 'open',
    authorEmail: caller.email,
    mergeSha: null,
    createdAt: Math.floor(Date.now() / 1000),
    mergedAt: null,
  }
  await useDb().insert(pulls).values(pull)
  return { number: pull.number }
})
