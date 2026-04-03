import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { sshEd25519ToKeyObject } from '../utils/ed25519.js'
import { requireManagementToken } from './admin.js'

export function createEnrollHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const body = await readBody<{
      email: string
      name: string
      publicKey: string
      owner: string
      approver?: string
    }>(event)

    if (!body.email || !body.name || !body.publicKey || !body.owner) {
      throw createProblemError({ status: 400, title: 'Missing required fields: email, name, publicKey, owner' })
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

    // Create user with owner set (makes it an agent)
    const user = await stores.userStore.create({
      email: body.email,
      name: body.name,
      owner: body.owner,
      approver: body.approver ?? body.owner,
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
      status: 'active',
    }
  })
}
