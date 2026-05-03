import { z } from 'zod'
import { resolveCaller } from '../../utils/auth'
import { assertMember } from '../../utils/membership'
import { findThreadById, updateThread } from '../../utils/threads'
import { broadcastToRoom } from '../../utils/realtime'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  archived: z.boolean().optional(),
}).refine(b => b.name !== undefined || b.archived !== undefined, {
  message: 'Provide at least one of name, archived',
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing thread id' })
  const existing = await findThreadById(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  await assertMember(existing.roomId, caller.email)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const updated = await updateThread(id, parsed.data)
  if (updated) {
    await broadcastToRoom(existing.roomId, {
      type: 'membership-changed',
      room_id: existing.roomId,
      payload: { thread: updated },
    })
  }
  return updated
})
