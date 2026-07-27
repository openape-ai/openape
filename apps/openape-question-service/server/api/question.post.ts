import type { SpTaskDb } from '@openape/sp-tasks'
import { dataMessage, enqueueTask } from '@openape/sp-tasks'
import { createError, defineEventHandler, readBody } from 'h3'
import { useDb } from '../database/drizzle'

const SYSTEM_PROMPT = 'Du bist ein hilfreicher Assistent. Antworte knapp und korrekt.'
const MAX_LEN = 4000

// Ask a question → enqueue an `llm` task for the bound service-agent. Returns the
// task id; the client polls GET /api/answer/[taskId] for the result. contextId is
// scoped to the caller so answers can only be read back by their owner.
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ question?: string }>(event)
  const question = body?.question?.trim()
  if (!question)
    throw createError({ statusCode: 400, statusMessage: 'question required' })
  if (question.length > MAX_LEN)
    throw createError({ statusCode: 413, statusMessage: 'question too long' })

  const db = useDb() as unknown as SpTaskDb
  const task = await enqueueTask(db, {
    type: 'llm',
    contextId: `ask:${caller.email}`,
    message: dataMessage({ systemPrompt: SYSTEM_PROMPT, userMessage: question }),
    now: Date.now(),
  })
  return { taskId: task.id }
})
