import { randomUUID } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { createRegistrationOptions } from '@openape/auth'
import { getRPConfig } from '../../utils/rp-config'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

// Mint a WebAuthn challenge for a new credential under the recovery flow.
// The recovery token's age + cancellation state is checked here so the
// client can't squeeze a challenge out of a not-yet-usable token.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token: string }>(event)
  if (!body?.token) {
    throw createProblemError({ status: 400, title: 'Missing required field: token' })
  }

  const { recoveryStore, challengeStore, userStore } = useIdpStores()
  const rpConfig = getRPConfig()

  const recovery = await recoveryStore.find(body.token)
  if (!recovery) {
    throw createProblemError({ status: 404, title: 'Invalid or expired recovery token' })
  }
  if (recovery.usableAt > Date.now()) {
    throw createProblemError({
      status: 425,
      title: 'Recovery token not yet usable',
      detail: `Token becomes usable at ${new Date(recovery.usableAt).toISOString()}. This delay is the security mechanism — the active owner has until then to cancel.`,
    })
  }

  const user = await userStore.findByEmail(recovery.email)
  // We DON'T error on missing user — recovery may be the first credential
  // for a newly-created shell (e.g. enrolled by an owner). What matters
  // is that the token is real, aged, and not cancelled. The verify step
  // will create the user row if needed.
  const displayName = user?.name ?? recovery.email

  // Pass empty excludeCredentials. The verify step will optionally
  // invalidate them all, so listing them as excluded would block the
  // exact case recovery is meant to solve (new device, no access to
  // old ones).
  const { options, challenge } = await createRegistrationOptions(rpConfig, recovery.email, displayName, [])

  const challengeToken = randomUUID()
  await challengeStore.save(challengeToken, {
    challenge,
    userEmail: recovery.email,
    type: 'registration',
    expiresAt: Date.now() + 5 * 60 * 1000,
    rpId: rpConfig.rpID,
  })

  return { options, challengeToken }
})
