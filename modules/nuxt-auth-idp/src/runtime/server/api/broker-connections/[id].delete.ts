import { defineEventHandler, getRouterParam } from 'h3'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { useBrokerStore } from '../../utils/broker-store'

export default defineEventHandler(async (event) => {
  const owner = await requireBrokerOwner(event, true)
  const id = getRouterParam(event, 'id')
  if (!id) throw new Error('Broker connection is required')
  await useBrokerStore(event).revokeConnection(id, owner)
  return { status: 'revoked' }
})
