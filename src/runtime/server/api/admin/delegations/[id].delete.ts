import { createError, defineEventHandler, getRouterParam } from 'h3'
import { revokeGrant } from '@openape/grants'
import { requireAdmin } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing delegation ID' })
  }

  const { grantStore } = useGrantStores()
  const grant = await grantStore.findById(id)

  if (!grant || grant.type !== 'delegation') {
    throw createError({ statusCode: 404, statusMessage: 'Delegation not found' })
  }

  const revoked = await revokeGrant(id, grantStore)
  return revoked
})
