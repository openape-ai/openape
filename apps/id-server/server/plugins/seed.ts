export default defineNitroPlugin(async () => {
  const { userStore } = useStores()

  const existing = await userStore.findByEmail('phofmann@example.org')
  if (!existing) {
    await userStore.register('phofmann@example.org', 'q1w2e3r4', 'Patrick Hofmann')
    console.log('[id-server] Seeded user: phofmann@example.org')
  }
})
