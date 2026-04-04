import { defineEventHandler, readBody } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { verifyEd25519Signature } from '../utils/ed25519.js'
import { issueAuthToken } from '../utils/auth-token.js'

export function createChallengeHandler(stores: IdPStores, _config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const body = await readBody<{ id: string }>(event)

    if (!body.id) {
      throw createProblemError({ status: 400, title: 'Missing required field: id' })
    }

    const user = await stores.userStore.findByEmail(body.id)
    if (user && user.isActive) {
      const challenge = await stores.challengeStore.createChallenge(user.email)
      return { challenge }
    }

    // Try user with SSH keys
    const sshKeys = await stores.sshKeyStore.findByUser(body.id)
    if (sshKeys.length > 0) {
      const challenge = await stores.challengeStore.createChallenge(body.id)
      return { challenge }
    }

    throw createProblemError({ status: 404, title: 'No user with SSH keys found for this identity' })
  })
}

export function createAuthenticateHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const body = await readBody<{
      id: string
      challenge: string
      signature: string
      public_key?: string
    }>(event)

    if (!body.id || !body.challenge || !body.signature) {
      throw createProblemError({ status: 400, title: 'Missing required fields: id, challenge, signature' })
    }

    const user = await stores.userStore.findByEmail(body.id)
    if (!user) {
      throw createProblemError({ status: 404, title: 'User not found' })
    }

    if (!user.isActive) {
      throw createProblemError({ status: 403, title: 'User is inactive' })
    }

    // Determine which SSH key to use for verification
    let sshKey
    if (body.public_key) {
      sshKey = await stores.sshKeyStore.findByPublicKey(body.public_key)
      if (!sshKey || sshKey.userEmail !== body.id) {
        throw createProblemError({ status: 404, title: 'SSH key not found for this user' })
      }
    }
    else {
      const keys = await stores.sshKeyStore.findByUser(body.id)
      if (keys.length === 0) {
        throw createProblemError({ status: 404, title: 'No SSH keys found for this user' })
      }
      if (keys.length > 1) {
        throw createProblemError({ status: 400, title: 'Multiple SSH keys registered. Specify public_key to identify which key to use.' })
      }
      sshKey = keys[0]!
    }

    // Consume challenge
    const valid = await stores.challengeStore.consumeChallenge(body.challenge, body.id)
    if (!valid) {
      throw createProblemError({ status: 401, title: 'Invalid, expired, or already used challenge' })
    }

    // Verify signature
    const signatureBuffer = Buffer.from(body.signature, 'base64')
    const isValid = verifyEd25519Signature(sshKey.publicKey, body.challenge, signatureBuffer)
    if (!isValid) {
      throw createProblemError({ status: 401, title: 'Invalid signature', type: 'https://ddisa.org/errors/invalid_token' })
    }

    // Determine act: explicit type > fallback (owner → agent, no owner → human)
    const act = user.type ?? (user.owner ? 'agent' as const : 'human' as const)

    const signingKey = await stores.keyStore.getSigningKey()
    const token = await issueAuthToken(
      { sub: user.email, act },
      config.issuer,
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
}
