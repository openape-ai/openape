import { introspectGrant } from '@openape/grants'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  return grant
})
