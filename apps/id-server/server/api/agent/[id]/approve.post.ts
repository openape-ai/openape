export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)
  const { agentStore } = useStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Agent ID is required' })
  }

  const agent = await agentStore.findById(id)
  if (!agent) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  if (agent.isActive) {
    throw createError({ statusCode: 400, statusMessage: 'Agent is already active' })
  }

  const body = await readBody<{
    owner?: string
    approver?: string
  }>(event).catch(() => ({}))

  const updated = await agentStore.update(id, {
    isActive: true,
    owner: body?.owner || adminEmail,
    approver: body?.approver || adminEmail,
  })

  return {
    agent_id: updated.id,
    name: updated.name,
    status: 'active',
    owner: updated.owner,
    approver: updated.approver,
  }
})
