import { createError, defineEventHandler, readBody } from 'h3'

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'agent'
}

function deriveAgentEmail(ownerEmail: string, agentName: string): string {
  const [local, domain] = ownerEmail.split('@')
  const safeName = sanitizeName(agentName)
  return `${safeName}+${local}+${domain!.replace(/\./g, '_')}@id.openape.at`
}

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const config = useRuntimeConfig()
  const maxAgents = config.public.maxAgentsPerUser

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

  const existingAgents = await agentStore.findByOwner(email)
  if (existingAgents.length >= maxAgents) {
    throw createError({ statusCode: 409, statusMessage: `Agent limit reached (${maxAgents}). Delete an existing agent first.` })
  }

  const agentEmail = deriveAgentEmail(email, body.name)

  const existingByEmail = await agentStore.findByEmail(agentEmail)
  if (existingByEmail) {
    throw createError({ statusCode: 409, statusMessage: 'An agent with this name already exists. Choose a different name.' })
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
