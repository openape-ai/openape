import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../utils/admin'
import { useIdpStores } from '../../../../utils/stores'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Missing email parameter' })
  }

  const { credentialStore } = useIdpStores()
  const credentials = await credentialStore.findByUser(email)

  return credentials.map(c => ({
    credentialId: c.credentialId,
    name: c.name,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt,
    transports: c.transports,
  }))
})
