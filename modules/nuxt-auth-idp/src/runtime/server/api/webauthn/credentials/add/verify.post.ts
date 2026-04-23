import { defineEventHandler, readBody } from 'h3'
import { verifyRegistration } from '@openape/auth'
import { requireAuth } from '../../../../utils/admin'
import { getRPConfig } from '../../../../utils/rp-config'
import { useIdpStores } from '../../../../utils/stores'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const body = await readBody<{ challengeToken: string, response: any, deviceName?: string }>(event)
  if (!body.challengeToken || !body.response) {
    throw createProblemError({ status: 400, title: 'Missing required fields: challengeToken, response' })
  }

  const { challengeStore, credentialStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const challenge = await challengeStore.consume(body.challengeToken)
  if (!challenge || challenge.userEmail !== userId) {
    throw createProblemError({ status: 400, title: 'Invalid or expired challenge' })
  }
  if (challenge.rpId && challenge.rpId !== rpConfig.rpID) {
    throw createProblemError({ status: 400, title: 'Challenge was issued for a different RP' })
  }

  const { verified, credential } = await verifyRegistration(body.response, challenge.challenge, rpConfig, userId)
  if (!verified || !credential) {
    throw createProblemError({ status: 400, title: 'Registration verification failed' })
  }

  credential.rpId = rpConfig.rpID
  if (body.deviceName) {
    credential.name = body.deviceName
  }

  await credentialStore.save(credential)

  return { ok: true, credentialId: credential.credentialId }
})
