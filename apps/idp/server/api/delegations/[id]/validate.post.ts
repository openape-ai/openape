import { validateDelegation } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const stores = await getStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing delegation ID' })
  }

  const body = await readBody<{ delegate: string, audience: string }>(event)
  if (!body?.delegate || !body?.audience) {
    throw createProblemError({ status: 400, title: 'Missing delegate or audience' })
  }

  try {
    const grant = await validateDelegation(id, body.delegate, body.audience, stores.grantStore)
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
