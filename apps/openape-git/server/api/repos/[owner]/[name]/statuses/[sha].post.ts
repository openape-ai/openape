import { createError, defineEventHandler, getRouterParam, readRawBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../../database/drizzle'
import { commitStatuses } from '../../../../../database/schema'
import { isValidSha } from '../../../../../utils/git-parse'
import { repoBySignedRequest } from '../../../../../utils/webhook-auth'

// A consumer report, not free-form storage: the log is capped so a runaway CI
// run cannot fill the registry database.
const MAX_LOG_BYTES = 64 * 1024
const STATES = ['pending', 'success', 'failure'] as const

/**
 * POST /api/repos/:owner/:name/statuses/:sha — a CI consumer reports its
 * result. Authorized by the webhook secret's HMAC over the raw body, so an
 * unattended runner needs no expiring token. One row per (sha, context):
 * re-reporting the same context replaces it (pending -> success/failure).
 */
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner') ?? ''
  const name = getRouterParam(event, 'name') ?? ''
  const sha = getRouterParam(event, 'sha') ?? ''
  if (!isValidSha(sha))
    throw createError({ statusCode: 400, statusMessage: 'sha must be a full commit sha' })

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const repo = await repoBySignedRequest(event, owner, name, raw)

  const body = JSON.parse(raw || '{}') as {
    state?: string
    context?: string
    description?: string
    targetUrl?: string
    log?: string
  }
  const state = body.state ?? ''
  if (!STATES.includes(state as typeof STATES[number]))
    throw createError({ statusCode: 400, statusMessage: `state must be one of ${STATES.join(', ')}` })
  const context = (body.context ?? '').trim() || 'ci'
  if (context.length > 100)
    throw createError({ statusCode: 400, statusMessage: 'context too long' })

  const log = body.log ? body.log.slice(-MAX_LOG_BYTES) : null
  const row = {
    id: ulid(),
    repoId: repo.id,
    sha,
    context,
    state,
    description: body.description?.slice(0, 500) ?? null,
    targetUrl: body.targetUrl?.slice(0, 500) ?? null,
    log,
    createdAt: Math.floor(Date.now() / 1000),
  }
  await useDb().insert(commitStatuses).values(row).onConflictDoUpdate({
    target: [commitStatuses.repoId, commitStatuses.sha, commitStatuses.context],
    set: { state: row.state, description: row.description, targetUrl: row.targetUrl, log: row.log, createdAt: row.createdAt },
  })
  return { ok: true, sha, context, state }
})
