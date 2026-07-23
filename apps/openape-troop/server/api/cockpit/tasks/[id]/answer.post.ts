import { cockpitOwner } from '../../../../utils/cockpit/auth'
import { answerTask, getTask } from '../../../../utils/cockpit/queue'
import { markAskAnswered, saveChatMessage } from '../../../../utils/cockpit/chat-store'
import { saveTask } from '../../../../utils/cockpit/task-store'

const MAX_CHOICE_LEN = 500

// The owner answers an open input-required question: the SAME task resumes with
// the choice appended (no new conversation). 404 when the task is gone (restart
// + prune) — the client then degrades to a normal message carrying the context.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const body = await readBody<{ choice?: unknown }>(event)
  const choice = typeof body?.choice === 'string' ? body.choice.trim() : ''
  if (!choice || choice.length > MAX_CHOICE_LEN)
    throw createError({ statusCode: 400, statusMessage: `choice required, ≤ ${MAX_CHOICE_LEN} chars` })
  const task = getTask(id)
  if (!task || task.owner !== owner) throw createError({ statusCode: 404, statusMessage: 'unknown task' })
  if (!answerTask(id, owner, choice)) throw createError({ statusCode: 409, statusMessage: 'task is not waiting for input' })
  // The conversation shows the pick; the stored ask flips to answered so chips settle.
  await saveChatMessage(task.company, owner, 'user', choice)
  await markAskAnswered(task.company, owner, id)
  // Durability: the resumed task re-runs with the enriched userMessage after a restart.
  void saveTask({ ...task, question: undefined, options: undefined, askedAt: undefined }).catch(err => console.error('[task-store] save', err))
  return { ok: true }
})
