import { defineEventHandler } from 'h3'
import { createRegistrationOptions } from '@openape/auth'
import { requireAuth } from '../../../../utils/admin'
import { getRPConfig } from '../../../../utils/rp-config'
import { useIdpStores } from '../../../../utils/stores'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const { credentialStore, challengeStore, userStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const user = await userStore.findByEmail(userId)
  if (!user) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  const existingCredentials = credentialStore.findByUserAndRp
    ? await credentialStore.findByUserAndRp(userId, rpConfig.rpID)
    : (await credentialStore.findByUser(userId)).filter(c => !c.rpId || c.rpId === rpConfig.rpID)
  const { options, challenge } = await createRegistrationOptions(rpConfig, userId, user.name, existingCredentials)

  const challengeToken = crypto.randomUUID()
  await challengeStore.save(challengeToken, {
    challenge,
    userEmail: userId,
    type: 'registration',
    expiresAt: Date.now() + 5 * 60 * 1000,
    rpId: rpConfig.rpID,
  })

  return { options, challengeToken }
})
