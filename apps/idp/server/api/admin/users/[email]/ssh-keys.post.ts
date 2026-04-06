import { createHash } from 'node:crypto'
import { requireAdmin } from '../../../../utils/admin-auth'
import { sshEd25519ToKeyObject } from '../../../../utils/ed25519'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const email = decodeURIComponent(getRouterParam(event, 'email')!)

  const body = await readBody<{ publicKey: string, name?: string }>(event)
  if (!body.publicKey || typeof body.publicKey !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing required field: publicKey' })
  }

  // Input length validation
  if (body.publicKey.length > 1000) {
    throw createProblemError({ status: 400, title: 'Public key must not exceed 1000 characters' })
  }
  if (body.name && body.name.length > 255) {
    throw createProblemError({ status: 400, title: 'Name must not exceed 255 characters' })
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

  // Ensure user exists - create if not
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
