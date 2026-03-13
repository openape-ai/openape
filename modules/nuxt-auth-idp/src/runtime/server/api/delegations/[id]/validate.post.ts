import { validateDelegation } from '@openape/grants'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useGrantStores } from '../../../utils/grant-stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing delegation ID' })
  }

  const body = await readBody<{ delegate: string, audience: string }>(event)
  if (!body?.delegate || !body?.audience) {
    throw createProblemError({ status: 400, title: 'Missing delegate or audience' })
  }

  try {
    const grant = await validateDelegation(id, body.delegate, body.audience, useGrantStores().grantStore)
    return {
      valid: true,
      delegation: grant,
      scopes: grant.request.scopes || [],
    }
  }
  catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Delegation validation failed',
    }
  }
})
