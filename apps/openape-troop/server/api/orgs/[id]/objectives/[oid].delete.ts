import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { objectives } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const oid = getRouterParam(event, 'oid')
  if (!oid) throw createError({ statusCode: 400, statusMessage: 'objective id required' })

  const db = useDb()
  await db.delete(objectives).where(and(eq(objectives.orgId, org.id), eq(objectives.id, oid)))
  return { ok: true }
})
