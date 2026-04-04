import type { EventHandler } from 'h3'
import { defineEventHandler, getQuery, readBody, useSession } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { verifyEd25519Signature } from '../utils/ed25519.js'

const IDP_SESSION_NAME = 'openape-idp'
const DEFAULT_SESSION_SECRET = 'default-secret-change-me-in-production!'

export function getSessionConfig(config: IdPConfig) {
  return {
    name: IDP_SESSION_NAME,
    password: config.sessionSecret || DEFAULT_SESSION_SECRET,
    cookie: {
      httpOnly: true,
      secure: config.issuer.startsWith('https://'),
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  }
}

/**
 * POST /api/session/login
 *
 * Headless session login: accepts { id, challenge, signature },
 * verifies the ed25519 signature, and sets a session cookie with { userId }.
 */
export function createSessionLoginHandler(stores: IdPStores, config: IdPConfig) {
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

    // Set session cookie
    const session = await useSession(event, getSessionConfig(config))
    await session.update({ userId: user.email })

    return { ok: true }
  })
}

/**
 * POST /api/session/logout
 *
 * Clears the IdP session cookie.
 */
export function createSessionLogoutHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const session = await useSession(event, getSessionConfig(config))
    await session.clear()
    return { ok: true }
  })
}

/**
 * GET /login
 *
 * Returns the returnTo parameter as JSON.
 * In a real app this would render a login form;
 * for headless/test usage it signals that login is required.
 */
export function createLoginPageHandler(): EventHandler {
  return defineEventHandler((event) => {
    const query = getQuery(event)
    return { loginRequired: true, returnTo: query.returnTo || '/' }
  })
}
