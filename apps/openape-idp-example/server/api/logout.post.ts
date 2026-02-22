export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  await session.clear()
  return { ok: true }
})
