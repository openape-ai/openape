export default defineEventHandler(async (event) => {
  const body = await readBody<{
    name: string
    publicKey: string
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

  // Create agent in pending (inactive) state — admin must approve
  const agent = await agentStore.create({
    id: crypto.randomUUID(),
    name: body.name,
    owner: 'pending',
    approver: 'pending',
    publicKey: body.publicKey,
    createdAt: Date.now(),
    isActive: false,
  })

  // Build enrollment URL for the admin to approve
  const baseUrl = IDP_ISSUER.trim()
  const enrollUrl = `${baseUrl}/enroll/${agent.id}`

  return {
    agent_id: agent.id,
    name: agent.name,
    status: 'pending_approval',
    enroll_url: enrollUrl,
    message: `Registration pending. Share this URL with your admin for approval: ${enrollUrl}`,
  }
})
