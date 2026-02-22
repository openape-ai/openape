export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { agentStore } = useStores()
  return await agentStore.listAll()
})
