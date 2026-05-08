import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { agents, tasks } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'
import { validateCron, validateTaskId, validateTools } from '../../../../utils/task-validation'

const bodySchema = z.object({
  task_id: z.string(),
  name: z.string().min(1).max(100),
  cron: z.string().min(1).max(50),
  system_prompt: z.string().min(1).max(8000),
  tools: z.array(z.string()),
  max_steps: z.number().int().min(1).max(50).default(10),
  enabled: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }

  // Cross-cut validation that's not type-shape: cron + tools + task_id
  // formatting all live in task-validation.ts so the same rules can be
  // reused on PUT.
  const cron = validateCron(body.data.cron)
  if (!cron.ok) throw createError({ statusCode: 400, statusMessage: cron.reason })
  const tid = validateTaskId(body.data.task_id)
  if (!tid.ok) throw createError({ statusCode: 400, statusMessage: tid.reason })
  const t = validateTools(body.data.tools)
  if (!t.ok) throw createError({ statusCode: 400, statusMessage: t.reason })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const now = Math.floor(Date.now() / 1000)
  await db.insert(tasks).values({
    agentEmail: agent.email,
    taskId: body.data.task_id,
    name: body.data.name,
    cron: body.data.cron,
    systemPrompt: body.data.system_prompt,
    tools: t.tools,
    maxSteps: body.data.max_steps,
    enabled: body.data.enabled,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [tasks.agentEmail, tasks.taskId],
    set: {
      name: body.data.name,
      cron: body.data.cron,
      systemPrompt: body.data.system_prompt,
      tools: t.tools,
      maxSteps: body.data.max_steps,
      enabled: body.data.enabled,
      updatedAt: now,
    },
  })

  return { agent_email: agent.email, task_id: body.data.task_id, updated_at: now }
})
