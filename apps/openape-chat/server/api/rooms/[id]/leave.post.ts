import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { memberships } from '../../../database/schema'
import { resolveCaller } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing room id' })
  }

  const db = useDb()
  await db
    .delete(memberships)
    .where(and(eq(memberships.roomId, id), eq(memberships.userEmail, caller.email)))

  return { ok: true }
})
