// Canonical: @openape/server createEnrollHandler
import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { useIdpStores } from '../../utils/stores'
import { requireAdmin } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)

  const body = await readBody<{
    id?: string
    email: string
    name: string
    publicKey: string
    owner?: string
    approver?: string
    type?: 'human' | 'agent'
  }>(event)

  if (!body.email || !body.name || !body.publicKey) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name, publicKey' })
  }

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

  const { userStore, sshKeyStore } = useIdpStores()

  // Check for duplicate
  const existing = await userStore.findByEmail(body.email)
  if (existing) {
    throw createProblemError({ status: 409, title: 'A user with this email already exists' })
  }

  // Compute keyId from public key
  const parts = body.publicKey.trim().split(/\s+/)
  const keyData = parts[1]!
  const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

  // Check for duplicate key
  const existingKey = await sshKeyStore.findByPublicKey(body.publicKey.trim())
  if (existingKey) {
    throw createProblemError({ status: 409, title: 'A user with this public key already exists' })
  }

  // Determine if this is a human or agent enrollment
  const isHuman = body.type === 'human' || !body.owner
  const owner = isHuman ? undefined : (body.owner || adminEmail)
  const approver = isHuman ? undefined : (body.approver || adminEmail)

  // Create user
  await userStore.create({
    email: body.email,
    name: body.name,
    owner,
    approver,
    type: isHuman ? 'human' : 'agent',
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // Create SSH key
  await sshKeyStore.save({
    keyId,
    userEmail: body.email,
    publicKey: body.publicKey.trim(),
    name: body.name,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return {
    email: body.email,
    name: body.name,
    owner: owner || body.email,
    status: 'active',
  }
})
