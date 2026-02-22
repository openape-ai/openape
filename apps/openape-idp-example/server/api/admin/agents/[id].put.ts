export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Agent ID is required' })
  }

  const body = await readBody<{
    name?: string
    owner?: string
    approver?: string
    publicKey?: string
    isActive?: boolean
  }>(event)

  if (body.publicKey && !body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  const existing = await agentStore.findById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.owner !== undefined) update.owner = body.owner
  if (body.approver !== undefined) update.approver = body.approver
  if (body.publicKey !== undefined) update.publicKey = body.publicKey
  if (body.isActive !== undefined) update.isActive = body.isActive

  const agent = await agentStore.update(id, update)
  return agent
})
