import { defineEventHandler, readBody } from 'h3'
import { verifyAuthentication } from '@openape/auth'
import { getAppSession } from '../../../utils/session'
import { getRPConfig } from '../../../utils/rp-config'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ challengeToken: string, response: any }>(event) ?? {} as { challengeToken: string, response: any }
  if (!body.challengeToken || !body.response) {
    throw createProblemError({ status: 400, title: 'Missing required fields: challengeToken, response' })
  }

  const { challengeStore, credentialStore, userStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const challenge = await challengeStore.consume(body.challengeToken)
  if (!challenge) {
    throw createProblemError({ status: 400, title: 'Invalid or expired challenge' })
  }
  if (challenge.rpId && challenge.rpId !== rpConfig.rpID) {
    throw createProblemError({ status: 400, title: 'Challenge was issued for a different RP' })
  }

  const credentialId = body.response.id
  const credential = await credentialStore.findById(credentialId)
  if (!credential) {
    throw createProblemError({ status: 400, title: 'Unknown credential' })
  }
  if (credential.rpId && credential.rpId !== rpConfig.rpID) {
    throw createProblemError({ status: 400, title: 'Credential belongs to a different RP' })
  }

  if (challenge.userEmail && credential.userEmail !== challenge.userEmail) {
    throw createProblemError({ status: 400, title: 'Credential does not belong to specified user' })
  }

  const { verified, newCounter } = await verifyAuthentication(body.response, challenge.challenge, rpConfig, credential)
  if (!verified) {
    throw createProblemError({ status: 400, title: 'Authentication verification failed' })
  }

  // Update counter
  if (newCounter !== undefined) {
    await credentialStore.updateCounter(credential.credentialId, newCounter)
  }

  const user = await userStore.findByEmail(credential.userEmail)
  if (!user) {
    throw createProblemError({ status: 400, title: 'User not found' })
  }

  // Create session
  const session = await getAppSession(event)
  await session.update({ userId: user.email, userName: user.name })

  return { ok: true, email: user.email, name: user.name }
})
