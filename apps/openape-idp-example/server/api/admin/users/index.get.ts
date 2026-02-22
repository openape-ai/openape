export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useStores()
  return await userStore.listUsers()
})
