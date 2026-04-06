import { createHash } from 'node:crypto'
import { sshEd25519ToKeyObject } from '../utils/ed25519'

/**
 * POST /api/register — consume a registration URL token and register an SSH key.
 */
export default defineEventHandler(async (event) => {
  const stores = await getStores()

  const body = await readBody<{
    token: string
    publicKey: string
    name?: string
  }>(event)

  if (!body.token) {
    throw createProblemError({ status: 400, title: 'Missing required field: token' })
  }
  if (!body.publicKey) {
    throw createProblemError({ status: 400, title: 'Missing required field: publicKey' })
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

  // Consume the registration token
  const reg = await stores.registrationUrlStore.consume(body.token)
  if (!reg) {
    throw createProblemError({ status: 404, title: 'Invalid, expired, or already used registration token' })
  }

  // Check for duplicate email
  const existing = await stores.userStore.findByEmail(reg.email)
  if (existing) {
    throw createProblemError({ status: 409, title: 'A user with this email already exists' })
  }

  // Check for duplicate public key
  const existingKey = await stores.sshKeyStore.findByPublicKey(body.publicKey)
  if (existingKey) {
    throw createProblemError({ status: 409, title: 'A user with this public key already exists' })
  }

  // Create the user
  await stores.userStore.create({
    email: reg.email,
    name: reg.name,
    type: 'human',
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
    userEmail: reg.email,
    publicKey: trimmedKey,
    name: body.name || reg.name,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return {
    ok: true,
    email: reg.email,
    name: reg.name,
  }
})
