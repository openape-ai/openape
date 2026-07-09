import { getTask, resolve } from '../../../../utils/cockpit/queue'
import { saveChatMessage } from '../../../../utils/cockpit/chat-store'
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
  if (state === 'completed' && task && task.owner === agent && text.trim()) await saveChatMessage(task.company, task.owner, 'assistant', text)
  return { ok: true }
})
