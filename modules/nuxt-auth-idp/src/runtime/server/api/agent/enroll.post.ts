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

  // Human enrollment: create user + SSH key (authenticates as act=human)
  if (body.type === 'human') {
    const { userStore, sshKeyStore } = useIdpStores()

    const existingUser = await userStore.findByEmail(body.email)
    if (!existingUser) {
      await userStore.create(body.email, body.name)
    }

    // Compute keyId from public key
    const parts = body.publicKey.trim().split(/\s+/)
    const keyData = parts[1]!
    const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')

    const existingKey = await sshKeyStore.findByPublicKey(body.publicKey.trim())
    if (!existingKey) {
      await sshKeyStore.save({
        keyId,
        userEmail: body.email,
        publicKey: body.publicKey.trim(),
        name: body.name,
        createdAt: Math.floor(Date.now() / 1000),
      })
    }

    return {
      email: body.email,
      name: body.name,
      owner: body.owner || body.email,
      status: 'active',
    }
  }

  // Agent enrollment (default)
  const { agentStore } = useIdpStores()

  const duplicateEmail = await agentStore.findByEmail(body.email)
  if (duplicateEmail) {
    throw createProblemError({ status: 409, title: 'An agent with this email already exists' })
  }

  const existingAgents = await agentStore.listAll()
  const duplicateKey = existingAgents.find(a => a.publicKey === body.publicKey)
  if (duplicateKey) {
    throw createProblemError({ status: 409, title: 'An agent with this public key already exists' })
  }

  const agent = await agentStore.create({
    id: body.id || crypto.randomUUID(),
    email: body.email,
    name: body.name,
    owner: body.owner || adminEmail,
    approver: body.approver || adminEmail,
    publicKey: body.publicKey,
    createdAt: Date.now(),
    isActive: true,
  })

  return {
    agent_id: agent.id,
    email: agent.email,
    name: agent.name,
    owner: agent.owner,
    approver: agent.approver,
    status: 'active',
  }
})
