import { defineEventHandler } from 'h3'
import { getSpSession } from '../utils/sp-session'

export default defineEventHandler(async (event) => {
  const session = await getSpSession(event)
  await session.clear()
  return { ok: true }
})
