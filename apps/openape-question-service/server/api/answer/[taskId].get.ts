import type { SpTaskDb, Task } from '@openape/sp-tasks'
import { getTask } from '@openape/sp-tasks'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../database/drizzle'

function lastText(task: Task): string {
  const parts = task.artifacts.at(-1)?.parts ?? []
  for (const p of parts) {
    if (p.kind === 'text')
      return p.text
  }
  return ''
}

// Poll a question's answer. Only the owner may read their own task (contextId is
// scoped to the caller; the id is an unguessable UUID, this is defence in depth).
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const taskId = getRouterParam(event, 'taskId')
  if (!taskId)
    throw createError({ statusCode: 400, statusMessage: 'taskId required' })

  const db = useDb() as unknown as SpTaskDb
  const task = await getTask(db, taskId)
  if (!task || task.metadata?.type !== 'llm' || task.contextId !== `ask:${caller.email}`)
    throw createError({ statusCode: 404, statusMessage: 'not found' })

  const state = task.status.state
  if (state === 'completed')
    return { state: 'completed' as const, answer: lastText(task) }
  if (state === 'failed' || state === 'canceled' || state === 'rejected')
    return { state: 'failed' as const, error: lastText(task) || 'agent failed' }
  return { state: 'pending' as const }
})
