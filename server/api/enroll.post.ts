import { createError, defineEventHandler, readBody } from 'h3'

function deriveAgentEmail(ownerEmail: string): string {
  const [local, domain] = ownerEmail.split('@')
  return `agent+${local}+${domain!.replace(/\./g, '_')}@id.openape.at`
}

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)

  const body = await readBody<{
    id?: string
    name: string
    publicKey: string
  }>(event)

  if (!body.name || !body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const { agentStore } = useIdpStores()

  // One-agent-per-user limit
  const existingAgents = await agentStore.findByOwner(email)
  if (existingAgents.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'You already have an agent registered. Delete it first to enroll a new one.' })
  }

  const agentEmail = deriveAgentEmail(email)

  const allAgents = await agentStore.listAll()
  const duplicateKey = allAgents.find(a => a.publicKey === body.publicKey)
  if (duplicateKey) {
    throw createError({ statusCode: 409, statusMessage: 'An agent with this public key already exists' })
  }

  const agent = await agentStore.create({
    id: body.id || crypto.randomUUID(),
    email: agentEmail,
    name: body.name,
    owner: email,
    approver: email,
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
