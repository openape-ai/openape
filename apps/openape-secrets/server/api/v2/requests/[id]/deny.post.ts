import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { secretAccessRequests } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { nowSec } from '../../../../utils/vault-passkeys'
import { requestStatus, requireOwnRequest } from '../../../../utils/vault-requests'

/** POST /api/v2/requests/:id/deny — say no. Only removes access, so the session suffices. */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const request = await requireOwnRequest(owner, getRouterParam(event, 'id'))
  const status = requestStatus(request)
  if (status !== 'pending_approval') throw createProblemError({ status: 409, title: `This request is ${status.replace('_', ' ')}` })
  await useDb().update(secretAccessRequests).set({ status: 'denied', decidedAt: nowSec() }).where(and(eq(secretAccessRequests.id, request.id), eq(secretAccessRequests.status, 'pending')))
  return { id: request.id, status: 'denied' }
})
