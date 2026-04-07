// Canonical: @openape/server createAuthenticateHandler
import { defineEventHandler, readBody } from 'h3'
import { getIdpIssuer, useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { verifyEd25519Signature } from '../../utils/ed25519'
import { issueAuthToken } from '../../utils/agent-token'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    id: string
    challenge: string
    signature: string
    public_key?: string
  }>(event)

  if (!body.id || !body.challenge || !body.signature) {
    throw createProblemError({ status: 400, title: 'Missing required fields: id, challenge, signature' })
  }

  const { sshKeyStore, userStore, keyStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  // Find SSH key to verify against
  let sshKey
  if (body.public_key) {
    sshKey = await sshKeyStore.findByPublicKey(body.public_key)
    if (!sshKey || sshKey.userEmail !== body.id) {
      throw createProblemError({ status: 404, title: 'SSH key not found for this user' })
    }
  }
  else {
    const keys = await sshKeyStore.findByUser(body.id)
    if (keys.length === 0) {
      throw createProblemError({ status: 404, title: 'No user with SSH keys found' })
    }
    if (keys.length > 1) {
      throw createProblemError({ status: 400, title: 'Multiple SSH keys registered. Specify public_key to identify which key to use.' })
    }
    sshKey = keys[0]!
  }

  // Verify user exists
  const user = await userStore.findByEmail(body.id)
  if (!user) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  const valid = await challengeStore.consumeChallenge(body.challenge, body.id)
  if (!valid) {
    throw createProblemError({ status: 401, title: 'Invalid, expired, or already used challenge' })
  }

  const signatureBuffer = Buffer.from(body.signature, 'base64')
  const isValid = verifyEd25519Signature(sshKey.publicKey, body.challenge, signatureBuffer)
  if (!isValid) {
    throw createProblemError({ status: 401, title: 'Invalid signature', type: 'https://ddisa.org/errors/invalid_token' })
  }

  // Determine act claim from user type/ownership
  const act = user.type ?? (user.owner ? 'agent' as const : 'human' as const)

  const signingKey = await keyStore.getSigningKey()
  const token = await issueAuthToken(
    { sub: user.email, act },
    getIdpIssuer(),
    signingKey.privateKey,
    signingKey.kid,
  )

  return {
    token,
    id: user.email,
    email: user.email,
    name: user.name,
    act,
    expires_in: 3600,
  }
})
