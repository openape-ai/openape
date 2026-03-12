import { defineEventHandler, readBody } from 'h3'
import { createAuthenticationOptions } from '@openape/auth'
import { getRPConfig } from '../../../utils/rp-config'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event) ?? {}

  const { credentialStore, challengeStore } = useIdpStores()
  const rpConfig = getRPConfig()

  let credentials
  if (body.email) {
    credentials = await credentialStore.findByUser(body.email)
    if (credentials.length === 0) {
      throw createProblemError({ status: 404, title: 'No passkeys found for this email' })
    }
  }

  const { options, challenge } = await createAuthenticationOptions(rpConfig, credentials)

  const challengeToken = crypto.randomUUID()
  await challengeStore.save(challengeToken, {
    challenge,
    userEmail: body.email,
    type: 'authentication',
    expiresAt: Date.now() + 5 * 60 * 1000,
  })

  return { options, challengeToken }
})
