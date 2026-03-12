import { defineEventHandler, getRouterParam } from 'h3'
import { revokeGrant } from '@openape/grants'
import { requireAdmin } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing delegation ID' })
  }

  const { grantStore } = useGrantStores()
  const grant = await grantStore.findById(id)

  if (!grant || grant.type !== 'delegation') {
    throw createProblemError({ status: 404, title: 'Delegation not found' })
  }

  const revoked = await revokeGrant(id, grantStore)
  return revoked
})
