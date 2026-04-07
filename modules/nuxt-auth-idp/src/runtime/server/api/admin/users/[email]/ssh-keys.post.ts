import { createHash } from 'node:crypto'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAdmin } from '../../../../utils/admin'
import { useIdpStores } from '../../../../utils/stores'
import { sshEd25519ToKeyObject } from '../../../../utils/ed25519'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Email is required' })
  }

  const body = await readBody<{ publicKey: string, name?: string }>(event)
  if (!body.publicKey || typeof body.publicKey !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing required field: publicKey' })
  }

  const trimmedKey = body.publicKey.trim()

  // Validate ssh-ed25519 format (throws if invalid)
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
  const keyData = parts[1]! // base64 encoded key data
  const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

  const { sshKeyStore, userStore } = useIdpStores()

  // Check for duplicate key
  const existing = await sshKeyStore.findByPublicKey(trimmedKey)
  if (existing) {
    throw createProblemError({ status: 409, title: 'This SSH key is already registered' })
  }

  // Ensure user exists — create if not
  const user = await userStore.findByEmail(email)
  if (!user) {
    await userStore.create({ email, name, isActive: true, createdAt: Math.floor(Date.now() / 1000) })
  }

  const sshKey = {
    keyId,
    userEmail: email,
    publicKey: trimmedKey,
    name,
    createdAt: Math.floor(Date.now() / 1000),
  }

  await sshKeyStore.save(sshKey)
  return sshKey
})
