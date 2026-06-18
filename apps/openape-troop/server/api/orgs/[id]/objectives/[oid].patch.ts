import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { objectives } from '../../../../database/schema'
import { requireOrgReadAccess } from '../../../../utils/orgs'

const Body = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  status: z.enum(['planned', 'in_progress', 'done', 'abandoned']).optional(),
  target_date: z.number().int().nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOrgReadAccess(event)
  const oid = getRouterParam(event, 'oid')
  if (!oid) throw createError({ statusCode: 400, statusMessage: 'objective id required' })

  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.description !== undefined) updates.description = parsed.data.description
  if (parsed.data.status !== undefined) updates.status = parsed.data.status
  if (parsed.data.target_date !== undefined) updates.targetDate = parsed.data.target_date

  const db = useDb()
  await db.update(objectives).set(updates).where(and(eq(objectives.orgId, org.id), eq(objectives.id, oid)))
  return { ok: true }
})
