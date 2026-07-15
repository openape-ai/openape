import { cockpitOwner } from '../../../../utils/cockpit/auth'
import { getTask } from '../../../../utils/cockpit/queue'

// Re-attach point after an SSE drop: the browser holds the task id (emitted as
// the first stream event) and polls here to resume the live progress + pick up
// the answer. Owner-bound. A missing task (completed+GC'd, or server restart)
// returns 404 → the client falls back to the persisted-answer poll.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const task = getTask(id)
  if (!task || task.owner !== owner) throw createError({ statusCode: 404, statusMessage: 'unknown task' })
  return { state: task.state, progress: task.progress, answer: task.answer }
})
