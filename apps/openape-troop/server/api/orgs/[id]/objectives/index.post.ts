import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { objectives } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'
import { newId, requireOwnedOrg } from '../../../../utils/orgs'

const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional().default(''),
  status: z.enum(['planned', 'in_progress', 'done', 'abandoned']).optional().default('planned'),
  target_date: z.number().int().nullable().optional(),
  parent_id: z.string().nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  // CEO will write here later via human-impersonating-as-CEO Bearer
  // tokens; for now Owner is the only writer.
  const owner = await requireOwner(event)

  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const now = Math.floor(Date.now() / 1000)
  const id = newId()
  const db = useDb()
  await db.insert(objectives).values({
    id,
    orgId: org.id,
    title: parsed.data.title,
    description: parsed.data.description,
    status: parsed.data.status,
    targetDate: parsed.data.target_date ?? null,
    parentId: parsed.data.parent_id ?? null,
    createdByEmail: owner,
    createdAt: now,
    updatedAt: now,
  })
  return { id }
})
