import { defineEventHandler } from 'h3'
import { getAppSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  await session.clear()
  return { ok: true }
})
