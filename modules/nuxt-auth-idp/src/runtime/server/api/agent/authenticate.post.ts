// Legacy alias — maps agent_id to id, delegates to /api/auth/authenticate logic
import { defineEventHandler, readBody } from 'h3'
import { getIdpIssuer, useIdpStores } from '../../utils/stores'
import { useGrantStores } from '../../utils/grant-stores'
import { verifyEd25519Signature } from '../../utils/ed25519'
import { issueAuthToken } from '../../utils/agent-token'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    agent_id: string
    challenge: string
    signature: string
  }>(event)

  if (!body.agent_id || !body.challenge || !body.signature) {
    throw createProblemError({ status: 400, title: 'Missing required fields: agent_id, challenge, signature' })
  }

  const { userStore, sshKeyStore, keyStore } = useIdpStores()
  const { challengeStore } = useGrantStores()

  const id = body.agent_id
  const user = await userStore.findByEmail(id)
  if (!user || !user.isActive) {
    throw createProblemError({ status: 404, title: 'User not found or inactive' })
  }

  const sshKeys = await sshKeyStore.findByUser(id)
  if (sshKeys.length === 0) {
    throw createProblemError({ status: 404, title: 'No SSH keys found for this user' })
  }

  const valid = await challengeStore.consumeChallenge(body.challenge, id)
  if (!valid) {
    throw createProblemError({ status: 401, title: 'Invalid, expired, or already used challenge' })
  }

  // Try each SSH key until one verifies
  const signatureBuffer = Buffer.from(body.signature, 'base64')
  const matchingKey = sshKeys.find(k => verifyEd25519Signature(k.publicKey, body.challenge, signatureBuffer))
  if (!matchingKey) {
    throw createProblemError({ status: 401, title: 'Invalid signature', type: 'https://ddisa.org/errors/invalid_token' })
  }

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
    agent_id: user.email,
    email: user.email,
    name: user.name,
    expires_in: 3600,
  }
})
