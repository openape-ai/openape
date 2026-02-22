import { introspectGrant } from '@clawgate/server'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useStores()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  return grant
})
