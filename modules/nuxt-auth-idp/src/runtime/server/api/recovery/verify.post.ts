import { defineEventHandler, readBody } from 'h3'
import { verifyRegistration } from '@openape/auth'
import { getAppSession } from '../../utils/session'
import { getRPConfig } from '../../utils/rp-config'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

// Complete the recovery: verify the WebAuthn ceremony, save the new
// credential, optionally invalidate all others (#297).
//
// Recovery is permission-to-enrol, not a session: even on success
// we return the new credential's metadata, not an access token. The
// client must perform a fresh login with the new credential.
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    token: string
    challengeToken: string
    response: any
    deviceName?: string
    invalidateOthers?: boolean
  }>(event)

  if (!body?.token || !body.challengeToken || !body.response) {
    throw createProblemError({ status: 400, title: 'Missing required fields: token, challengeToken, response' })
  }

  const { recoveryStore, challengeStore, credentialStore, userStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const recovery = await recoveryStore.find(body.token)
  if (!recovery) {
    throw createProblemError({ status: 404, title: 'Invalid or expired recovery token' })
  }
  if (recovery.usableAt > Date.now()) {
    throw createProblemError({
      status: 425,
      title: 'Recovery token not yet usable',
      detail: `Token becomes usable at ${new Date(recovery.usableAt).toISOString()}.`,
    })
  }

  const challenge = await challengeStore.consume(body.challengeToken)
  if (!challenge) {
    throw createProblemError({ status: 400, title: 'Invalid or expired challenge' })
  }
  if (challenge.rpId && challenge.rpId !== rpConfig.rpID) {
    throw createProblemError({ status: 400, title: 'Challenge was issued for a different RP' })
  }
  if (challenge.userEmail !== recovery.email) {
    // Mismatch between recovery token and challenge — refuse rather
    // than risk binding a credential to the wrong account.
    throw createProblemError({ status: 400, title: 'Challenge does not match recovery token email' })
  }

  const { verified, credential } = await verifyRegistration(body.response, challenge.challenge, rpConfig, recovery.email)
  if (!verified || !credential) {
    throw createProblemError({ status: 400, title: 'Registration verification failed' })
  }

  credential.rpId = rpConfig.rpID
  if (body.deviceName) {
    credential.name = body.deviceName
  }

  // Optionally invalidate every other credential first. Default ON in
  // the UI per #297 — when a user is recovering, the safe assumption
  // is that the old devices are lost or compromised. The new credential
  // is saved AFTER the deleteAllForUser so we never end up in a zero-
  // credential state.
  const invalidateOthers = body.invalidateOthers ?? true
  if (invalidateOthers) {
    await credentialStore.deleteAllForUser(recovery.email)
  }

  // Ensure the user row exists (a recovery may legitimately be the
  // first enrolment for a shell account).
  const existingUser = await userStore.findByEmail(recovery.email)
  if (!existingUser) {
    await userStore.create({
      email: recovery.email,
      name: recovery.email,
      isActive: true,
      createdAt: Math.floor(Date.now() / 1000),
    })
  }

  await credentialStore.save(credential)
  await recoveryStore.markConsumed(body.token)

  // Ops log only. The durable audit trail is the recovery store itself
  // (tokens survive consumption and are surfaced via listAllForEmail,
  // #462) — this warn adds token id + invalidateOthers for server logs.
  console.warn('[openape-idp] recovery completed', {
    email: recovery.email,
    token: recovery.token,
    requestedAt: recovery.createdAt,
    requestIp: recovery.requestIp,
    invalidateOthers,
  })

  // Don't establish a session — recovery is permission-to-enrol only.
  // Client must perform a fresh login with the new credential.
  const session = await getAppSession(event)
  await session.clear()

  return {
    ok: true,
    email: recovery.email,
    credentialId: credential.credentialId,
    invalidateOthers,
  }
})
