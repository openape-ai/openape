import { defineEventHandler } from 'h3'
import { requireAuth } from '../../utils/admin'
import { useIdpStores } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const { credentialStore } = useIdpStores()

  const credentials = await credentialStore.findByUser(userId)

  return credentials.map(c => ({
    credentialId: c.credentialId,
    name: c.name,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt,
    transports: c.transports,
  }))
})
