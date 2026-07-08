import { resolve  } from '../../../../utils/cockpit/queue'
import type { TaskState } from '../../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

export default defineEventHandler(async (event) => {
  await requireCockpitAgent(event)
  const body = await readBody<{ id?: string; state?: TaskState; artifact?: { parts?: { kind?: string; text?: string }[] } }>(event)
  const id = body?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const state: TaskState = body?.state ?? 'completed'
  const text = (body?.artifact?.parts ?? []).find(p => p.kind === 'text')?.text ?? ''
  resolve(id, state, text)
  return { ok: true }
})
