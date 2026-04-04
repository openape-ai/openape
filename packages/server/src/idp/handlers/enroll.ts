import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { sshEd25519ToKeyObject } from '../utils/ed25519.js'
import { hasManagementToken } from './admin.js'
import { verifyBearerAuth } from '../utils/bearer-auth.js'

export function createEnrollHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    // --- Determine auth method: management token or Bearer token ---
    const isMgmt = hasManagementToken(event, config)

    let callerEmail: string | undefined
    if (!isMgmt) {
      const payload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
      if (!payload) {
        throw createProblemError({ status: 401, title: 'Authentication required (management token or Bearer token)' })
      }
      if (payload.act !== 'human') {
        throw createProblemError({ status: 403, title: 'Only human users may enroll sub-users' })
      }
      callerEmail = payload.sub
    }

    const body = await readBody<{
      email: string
      name: string
      publicKey: string
      owner?: string
      approver?: string
      type?: 'human' | 'agent'
    }>(event)

    // --- Validate required fields ---
    // For management token: owner is required in body
    // For Bearer token: owner is automatically set to caller
    if (isMgmt) {
      if (!body.email || !body.name || !body.publicKey || !body.owner) {
        throw createProblemError({ status: 400, title: 'Missing required fields: email, name, publicKey, owner' })
      }
    }
    else {
      if (!body.email || !body.name || !body.publicKey) {
        throw createProblemError({ status: 400, title: 'Missing required fields: email, name, publicKey' })
      }
    }

    // Input length validation
    if (body.email.length > 255) {
      throw createProblemError({ status: 400, title: 'Email must not exceed 255 characters' })
    }
    if (body.name.length > 255) {
      throw createProblemError({ status: 400, title: 'Name must not exceed 255 characters' })
    }
    if (body.publicKey.length > 1000) {
      throw createProblemError({ status: 400, title: 'Public key must not exceed 1000 characters' })
    }

    if (!body.publicKey.startsWith('ssh-ed25519 ')) {
      throw createProblemError({ status: 400, title: 'Public key must be in ssh-ed25519 format' })
    }

    // Validate key format
    try {
      sshEd25519ToKeyObject(body.publicKey)
    }
    catch {
      throw createProblemError({ status: 400, title: 'Invalid SSH key format' })
    }

    // Check for duplicate email
    const existing = await stores.userStore.findByEmail(body.email)
    if (existing) {
      throw createProblemError({ status: 409, title: 'A user with this email already exists' })
    }

    // Check for duplicate public key
    const existingKey = await stores.sshKeyStore.findByPublicKey(body.publicKey)
    if (existingKey) {
      throw createProblemError({ status: 409, title: 'A user with this public key already exists' })
    }

    // --- Determine owner, approver, type ---
    const owner = isMgmt ? body.owner! : callerEmail!
    const approver = isMgmt ? (body.approver ?? owner) : callerEmail!
    const type = body.type ?? 'agent'

    // Create user
    const user = await stores.userStore.create({
      email: body.email,
      name: body.name,
      owner,
      approver,
      type,
      isActive: true,
      createdAt: Date.now(),
    })

    // Register SSH key
    const trimmedKey = body.publicKey.trim()
    const parts = trimmedKey.split(/\s+/)
    const keyData = parts[1]!
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

    await stores.sshKeyStore.save({
      keyId,
      userEmail: body.email,
      publicKey: trimmedKey,
      name: body.name,
      createdAt: Math.floor(Date.now() / 1000),
    })

    return {
      email: user.email,
      name: user.name,
      owner: user.owner,
      approver: user.approver,
      type,
      status: 'active',
    }
  })
}
