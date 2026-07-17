import { getTask, resolve } from '../../../../utils/cockpit/queue'
import { saveChatMessage } from '../../../../utils/cockpit/chat-store'
import { removeTask } from '../../../../utils/cockpit/task-store'
import type { TaskState } from '../../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const body = await readBody<{ id?: string; state?: TaskState; artifact?: { parts?: { kind?: string; text?: string }[] } }>(event)
  const id = body?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const state: TaskState = body?.state ?? 'completed'
  const text = (body?.artifact?.parts ?? []).find(p => p.kind === 'text')?.text ?? ''
  const task = getTask(id)
  resolve(id, state, text, agent)
  // Persist the assistant turn for both outcomes: a completed answer, or a failed
  // task's honest notice — so a failure leaves a visible message instead of silence.
  if ((state === 'completed' || state === 'failed') && task && task.owner === agent && text.trim()) await saveChatMessage(task.company, task.owner, 'assistant', text)
  // Task is terminal → drop its durability row so it isn't re-run after a restart.
  if (state === 'completed' || state === 'failed') void removeTask(id).catch(err => console.error('[task-store] remove', err))
  return { ok: true }
})
