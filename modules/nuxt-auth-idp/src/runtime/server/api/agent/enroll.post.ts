// Canonical: @openape/server createEnrollHandler
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
