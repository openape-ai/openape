import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing agent ID' })
  }

  const { agentStore } = useIdpStores()
  const agent = await agentStore.findById(id)

  if (!agent || agent.owner !== email) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  const body = await readBody<{ publicKey: string }>(event)

  if (!body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required field: publicKey' })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  return await agentStore.update(id, { publicKey: body.publicKey })
})
