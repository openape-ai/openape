export default defineNitroPlugin(async () => {
  const { ensureTables } = await import('../database/migrate')
  const { useDb } = await import('../database/client')
  const db = useDb()
  await ensureTables(db)
  console.log('[idp] Database tables ensured')
})
