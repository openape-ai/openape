import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { isInternalToken } from '../../utils/internal-token'
import { dispatchMirrorPush, dispatchPushEvent } from '../../utils/push-dispatch'
import { findRepo } from '../../utils/repos'

interface PushEventBody {
  owner?: string
  name?: string
  updates?: { before: string, after: string, ref: string }[]
  pusher?: { email?: string, act?: string, delegator?: string }
}

/**
 * POST /api/internal/push-event — the post-receive hook reporting a push.
 * Loopback only: authorized by the per-process internal token the transport
 * hands down to the hook, never by a session or a grant.
 */
export default defineEventHandler(async (event) => {
  if (!isInternalToken(getHeader(event, 'x-ape-internal-token')))
    throw createError({ statusCode: 401, statusMessage: 'internal token required' })

  const body = await readBody<PushEventBody>(event)
  const repo = await findRepo(body?.owner ?? '', body?.name ?? '')
  if (!repo) throw createError({ statusCode: 404, statusMessage: 'repo not found' })

  // Not awaited: post-receive waits for this response, so awaiting the mirror
  // would hold the user's `git push` open until the far forge answers.
  void dispatchMirrorPush(repo, body?.updates ?? [])
    .catch(err => console.error('[ape-git] mirror dispatch failed', err))

  const delivered = await dispatchPushEvent(repo, body?.updates ?? [], {
    email: body?.pusher?.email ?? '',
    act: body?.pusher?.act ?? 'agent',
    ...(body?.pusher?.delegator ? { delegator: body.pusher.delegator } : {}),
  })
  return { delivered }
})
