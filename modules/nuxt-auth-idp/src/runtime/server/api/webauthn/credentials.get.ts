import { defineEventHandler } from 'h3'
import { requireAuth } from '../../utils/admin'
import { getRPConfig } from '../../utils/rp-config'
import { useIdpStores } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const { credentialStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const credentials = credentialStore.findByUserAndRp
    ? await credentialStore.findByUserAndRp(userId, rpConfig.rpID)
    : (await credentialStore.findByUser(userId)).filter(c => !c.rpId || c.rpId === rpConfig.rpID)

  return credentials.map(c => ({
    credentialId: c.credentialId,
    name: c.name,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    createdAt: c.createdAt,
    transports: c.transports,
    rpId: c.rpId,
  }))
})
