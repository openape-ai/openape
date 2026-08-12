import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { kpis } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { validateKpiInput } from '../../utils/kpi-shape'

/**
 * POST /api/kpis — append one KPI row. `owner` and `source` come from the
 * caller's token, never from the body: a delegated agent pushes for its user.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody(event)

  const result = validateKpiInput(body)
  if (!result.ok)
    throw createProblemError({ status: 400, title: result.error })

  const row = {
    id: ulid(),
    owner: caller.email,
    ...result.kpi,
    source: caller.act,
    createdAt: Date.now(),
  }
  await useDb().insert(kpis).values(row)

  setResponseStatus(event, 201)
  return { kpi: row }
})
