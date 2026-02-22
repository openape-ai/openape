export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Agent ID is required' })
  }

  const existing = await agentStore.findById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
  }

  await agentStore.delete(id)
  return { ok: true }
})
