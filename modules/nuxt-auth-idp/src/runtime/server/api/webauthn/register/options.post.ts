import { defineEventHandler, readBody } from 'h3'
import { createRegistrationOptions } from '@openape/auth'
import { getRPConfig } from '../../../utils/rp-config'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token: string }>(event)
  if (!body.token) {
    throw createProblemError({ status: 400, title: 'Missing required field: token' })
  }

  const { registrationUrlStore, credentialStore, challengeStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const regUrl = await registrationUrlStore.find(body.token)
  if (!regUrl) {
    throw createProblemError({ status: 404, title: 'Invalid or expired registration URL' })
  }

  const existingCredentials = credentialStore.findByUserAndRp
    ? await credentialStore.findByUserAndRp(regUrl.email, rpConfig.rpID)
    : (await credentialStore.findByUser(regUrl.email)).filter(c => !c.rpId || c.rpId === rpConfig.rpID)
  const { options, challenge } = await createRegistrationOptions(rpConfig, regUrl.email, regUrl.name, existingCredentials)

  const challengeToken = crypto.randomUUID()
  await challengeStore.save(challengeToken, {
    challenge,
    userEmail: regUrl.email,
    type: 'registration',
    expiresAt: Date.now() + 5 * 60 * 1000,
    rpId: rpConfig.rpID,
  })

  return { options, challengeToken }
})
