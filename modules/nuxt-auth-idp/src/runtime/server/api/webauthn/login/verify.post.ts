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

  const { challengeStore, credentialStore, userStore, recoveryStore } = useIdpStores()
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

  // Account activity feeds the adaptive recovery cooldown (#462): a login
  // within the last 30 days stretches the recovery wait from 72h to 7d.
  await userStore.update(user.email, { lastLoginAt: Date.now() })

  // Active-owner veto for any pending recovery (#297). A successful
  // login from an existing credential proves the user still has access,
  // so any in-flight recovery is presumptively unauthorised. Silent —
  // surfacing the cancellation count here would leak the existence of
  // a recovery attempt; the audit log (future) is the right place.
  const cancelled = await recoveryStore.cancelAllForEmail(user.email, 'cancelled-by-successful-login')
  if (cancelled > 0) {
    console.warn('[openape-idp] cancelled pending recovery on login', { email: user.email, count: cancelled })
  }

  // Create session
  const session = await getAppSession(event)
  await session.update({ userId: user.email, userName: user.name })

  return { ok: true, email: user.email, name: user.name }
})
