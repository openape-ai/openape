import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { organizations } from '../../database/schema'
import { requireOwner } from '../../utils/auth'
import { newId } from '../../utils/orgs'

const Body = z.object({
  name: z.string().min(1).max(80),
  vision_md: z.string().max(40_000).optional().default(''),
  budget_monthly_eur: z.number().int().min(0).max(1_000_000).optional().default(0),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const now = Math.floor(Date.now() / 1000)
  const id = newId()
  const db = useDb()

  await db.insert(organizations).values({
    id,
    ownerEmail: owner.toLowerCase(),
    name: parsed.data.name,
    visionMd: parsed.data.vision_md,
    budgetMonthlyEur: parsed.data.budget_monthly_eur,
    createdAt: now,
    updatedAt: now,
  })

  return { id, name: parsed.data.name }
})
