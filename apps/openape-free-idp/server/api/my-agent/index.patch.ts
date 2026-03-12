import { createError, defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { agentStore } = useIdpStores()
  const agents = await agentStore.findByOwner(email)

  if (agents.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'No agent found' })
  }

  const body = await readBody<{ publicKey: string }>(event)

  if (!body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required field: publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const agent = agents[0]!

  return await agentStore.update(agent.id, { publicKey: body.publicKey })
})
