import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { runs } from '../../../../database/schema'
import { requireAgent } from '../../../../utils/auth'

const bodySchema = z.object({
  task_id: z.string().min(1),
})

// Agent claims a run-id at the start of a run. Returns `{ id }` so
// the agent can PATCH it on completion. Status starts as 'running';
// finishedAt is null until the PATCH lands.
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }

  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await useDb().insert(runs).values({
    id,
    agentEmail,
    taskId: body.data.task_id,
    startedAt: now,
    status: 'running',
  })
  return { id, started_at: now }
})
