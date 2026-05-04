import { defineEventHandler, readBody } from 'h3'
import { verifyRegistration } from '@openape/auth'
import { getAppSession } from '../../../utils/session'
import { getRPConfig } from '../../../utils/rp-config'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ token: string, challengeToken: string, response: any, deviceName?: string }>(event)
  if (!body.token || !body.challengeToken || !body.response) {
    throw createProblemError({ status: 400, title: 'Missing required fields: token, challengeToken, response' })
  }

  const { registrationUrlStore, challengeStore, credentialStore, userStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const regUrl = await registrationUrlStore.find(body.token)
  if (!regUrl) {
    throw createProblemError({ status: 404, title: 'Invalid or expired registration URL' })
  }

  const challenge = await challengeStore.consume(body.challengeToken)
  if (!challenge) {
    throw createProblemError({ status: 400, title: 'Invalid or expired challenge' })
  }
  if (challenge.rpId && challenge.rpId !== rpConfig.rpID) {
    throw createProblemError({ status: 400, title: 'Challenge was issued for a different RP' })
  }

  const { verified, credential } = await verifyRegistration(body.response, challenge.challenge, rpConfig, regUrl.email)
  if (!verified || !credential) {
    throw createProblemError({ status: 400, title: 'Registration verification failed' })
  }

  credential.rpId = rpConfig.rpID
  if (body.deviceName) {
    credential.name = body.deviceName
  }

  const existingUser = await userStore.findByEmail(regUrl.email)

  // SECURITY GATE — close the passkey-graft path (#291).
  //
  // Before this gate, the unauthenticated mail-token-only flow let
  // anyone with read-access to the user's mailbox (transient, leaked
  // dump, recycled provider) APPEND a fresh credential to an account
  // that already had passkeys. That credential then survives every
  // password-reset / recovery flow because there is no password — the
  // attacker's passkey is itself a first-class credential.
  //
  // First-time enrolment (no user yet, or user but zero credentials)
  // stays self-service here — the mail token is the only trust anchor
  // possible when no credentials exist yet. Add-device for users who
  // already have credentials goes through the authenticated
  // POST /api/webauthn/credentials/add/verify path (requires a fresh
  // assertion against an existing credential). Recovery for users who
  // lost everything goes through the new 72h-mail-hold flow specified
  // in #297.
  if (existingUser) {
    const existingCredentials = await credentialStore.findByUser(regUrl.email)
    if (existingCredentials.length > 0) {
      throw createProblemError({
        status: 409,
        title: 'Account already has passkeys — sign in to add a new device',
        detail:
          'This email is already enrolled. To add a new device, sign in '
          + 'on a device that already has a passkey and use Account → '
          + 'Add device. If you have lost access to all your devices, '
          + 'use the recovery flow. Self-service appending of '
          + 'credentials via the mail-token path is no longer permitted '
          + 'because it allowed account takeover via mailbox compromise.',
      })
    }
  }

  if (!existingUser) {
    await userStore.create({ email: regUrl.email, name: regUrl.name, isActive: true, createdAt: Math.floor(Date.now() / 1000) })
  }

  await credentialStore.save(credential)

  // Only consume the token after everything succeeded
  await registrationUrlStore.consume(body.token)

  // Create session
  const session = await getAppSession(event)
  await session.update({ userId: regUrl.email, userName: regUrl.name })

  return { ok: true, email: regUrl.email, name: regUrl.name }
})
