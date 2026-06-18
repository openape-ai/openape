import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { organizations } from '../../../database/schema'
import { requireOwnedOrg } from '../../../utils/orgs'

const Body = z.object({
  name: z.string().min(1).max(80).optional(),
  vision_md: z.string().max(40_000).optional(),
  budget_monthly_eur: z.number().int().min(0).max(1_000_000).optional(),
})

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.vision_md !== undefined) updates.visionMd = parsed.data.vision_md
  if (parsed.data.budget_monthly_eur !== undefined) updates.budgetMonthlyEur = parsed.data.budget_monthly_eur

  const db = useDb()
  await db.update(organizations).set(updates).where(eq(organizations.id, org.id))
  return { ok: true }
})
