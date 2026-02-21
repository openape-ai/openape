export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)

  const body = await readBody<{
    id?: string
    name: string
    publicKey: string
    owner?: string
    approver?: string
  }>(event)

  if (!body.name || !body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const { agentStore } = useStores()

  // Check for duplicate public key
  const existingAgents = await agentStore.listAll()
  const duplicate = existingAgents.find((a) => a.publicKey === body.publicKey)
  if (duplicate) {
    throw createError({ statusCode: 409, statusMessage: 'An agent with this public key already exists' })
  }

  const agent = await agentStore.create({
    id: body.id || crypto.randomUUID(),
    name: body.name,
    owner: body.owner || adminEmail,
    approver: body.approver || adminEmail,
    publicKey: body.publicKey,
    createdAt: Date.now(),
    isActive: true,
  })

  return {
    agent_id: agent.id,
    name: agent.name,
    owner: agent.owner,
    approver: agent.approver,
    status: 'active',
  }
})
