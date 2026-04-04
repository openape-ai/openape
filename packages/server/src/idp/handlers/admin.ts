import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { defineEventHandler, getRequestHeader, getRouterParam, readBody } from 'h3'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { sshEd25519ToKeyObject } from '../utils/ed25519.js'

export function requireManagementToken(event: H3Event, config: IdPConfig): void {
  if (!config.managementToken) {
    throw createProblemError({ status: 501, title: 'Management token not configured' })
  }
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader) {
    throw createProblemError({ status: 401, title: 'Authorization header required' })
  }
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (token !== config.managementToken) {
    throw createProblemError({ status: 403, title: 'Invalid management token' })
  }
}

/** Check if the request carries a valid management token (non-throwing). */
export function hasManagementToken(event: H3Event, config: IdPConfig): boolean {
  if (!config.managementToken) return false
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '')
  return token === config.managementToken
}

// --- List Users ---
export function createListUsersHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)
    const users = await stores.userStore.list()
    return users.map(u => ({ email: u.email, name: u.name, isActive: u.isActive, owner: u.owner, createdAt: u.createdAt }))
  })
}

// --- Delete User ---
export function createDeleteUserHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const email = decodeURIComponent(getRouterParam(event, 'email')!)
    const user = await stores.userStore.findByEmail(email)
    if (!user) {
      throw createProblemError({ status: 404, title: 'User not found' })
    }

    // Delete user's SSH keys first
    await stores.sshKeyStore.deleteAllForUser(email)
    await stores.userStore.delete(email)
    return { ok: true }
  })
}

// --- Create User ---
export function createCreateUserHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const body = await readBody<{ email: string, name: string, password?: string }>(event)
    if (!body.email || !body.name) {
      throw createProblemError({ status: 400, title: 'Missing required fields: email, name' })
    }

    const existing = await stores.userStore.findByEmail(body.email)
    if (existing) {
      throw createProblemError({ status: 409, title: 'User already exists' })
    }

    const user = await stores.userStore.create({
      email: body.email,
      name: body.name,
      isActive: true,
      createdAt: Date.now(),
    })
    return { ok: true, email: user.email, name: user.name }
  })
}

// --- Add SSH Key ---
export function createAddSshKeyHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const email = decodeURIComponent(getRouterParam(event, 'email')!)

    const body = await readBody<{ publicKey: string, name?: string }>(event)
    if (!body.publicKey || typeof body.publicKey !== 'string') {
      throw createProblemError({ status: 400, title: 'Missing required field: publicKey' })
    }

    const trimmedKey = body.publicKey.trim()

    // Validate ssh-ed25519 format
    try {
      sshEd25519ToKeyObject(trimmedKey)
    }
    catch {
      throw createProblemError({ status: 400, title: 'Invalid SSH key. Must be ssh-ed25519 format.' })
    }

    // Extract comment as fallback name
    const parts = trimmedKey.split(/\s+/)
    const comment = parts.length >= 3 ? parts.slice(2).join(' ') : undefined
    const name = body.name || comment || 'SSH Key'

    // Compute SHA256 fingerprint as keyId
    const keyData = parts[1]!
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

    // Check for duplicate key
    const existing = await stores.sshKeyStore.findByPublicKey(trimmedKey)
    if (existing) {
      throw createProblemError({ status: 409, title: 'This SSH key is already registered' })
    }

    // Ensure user exists — create if not
    const user = await stores.userStore.findByEmail(email)
    if (!user) {
      await stores.userStore.create({
        email,
        name,
        isActive: true,
        createdAt: Date.now(),
      })
    }

    const sshKey = {
      keyId,
      userEmail: email,
      publicKey: trimmedKey,
      name,
      createdAt: Math.floor(Date.now() / 1000),
    }

    await stores.sshKeyStore.save(sshKey)
    return sshKey
  })
}

// --- List SSH Keys ---
export function createListSshKeysHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const email = decodeURIComponent(getRouterParam(event, 'email')!)

    return await stores.sshKeyStore.findByUser(email)
  })
}

// --- Delete SSH Key ---
export function createDeleteSshKeyHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    requireManagementToken(event, config)

    const keyId = getRouterParam(event, 'keyId')!

    const existing = await stores.sshKeyStore.findById(keyId)
    if (!existing) {
      throw createProblemError({ status: 404, title: 'SSH key not found' })
    }

    await stores.sshKeyStore.delete(keyId)
    return { ok: true }
  })
}
