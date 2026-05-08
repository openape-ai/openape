import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { agents, tasks } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'
import { validateCron, validateTools } from '../../../../utils/task-validation'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cron: z.string().min(1).max(50).optional(),
  system_prompt: z.string().min(1).max(8000).optional(),
  tools: z.array(z.string()).optional(),
  max_steps: z.number().int().min(1).max(50).optional(),
  enabled: z.boolean().optional(),
})

// Partial-update PUT: any subset of fields. We re-run cron + tools
// validation on the new values when present (and only when present)
// so the editor can change one field at a time without re-sending
// the full task spec.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const taskId = getRouterParam(event, 'taskId')
  if (!name || !taskId) {
    throw createError({ statusCode: 400, statusMessage: 'name and taskId required' })
  }

  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }
  if (Object.keys(body.data).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'no fields to update' })
  }

  if (body.data.cron) {
    const c = validateCron(body.data.cron)
    if (!c.ok) throw createError({ statusCode: 400, statusMessage: c.reason })
  }
  if (body.data.tools) {
    const t = validateTools(body.data.tools)
    if (!t.ok) throw createError({ statusCode: 400, statusMessage: t.reason })
  }

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }
  if (body.data.name !== undefined) updates.name = body.data.name
  if (body.data.cron !== undefined) updates.cron = body.data.cron
  if (body.data.system_prompt !== undefined) updates.systemPrompt = body.data.system_prompt
  if (body.data.tools !== undefined) updates.tools = body.data.tools
  if (body.data.max_steps !== undefined) updates.maxSteps = body.data.max_steps
  if (body.data.enabled !== undefined) updates.enabled = body.data.enabled

  const result = await db
    .update(tasks)
    .set(updates)
    .where(and(eq(tasks.agentEmail, agent.email), eq(tasks.taskId, taskId)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'task not found' })
  }

  return result[0]
})
