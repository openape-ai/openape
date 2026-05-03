import { resolveCaller } from '../../utils/auth'
import { assertMember } from '../../utils/membership'
import { findThreadById, updateThread } from '../../utils/threads'
import { broadcastToRoom } from '../../utils/realtime'

// Soft-delete: archive only. Preserves message history (so a user can
// re-open and read past context). Hard-delete is intentionally not
// exposed in v1 to avoid accidental loss.
export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing thread id' })
  const existing = await findThreadById(id)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  await assertMember(existing.roomId, caller.email)
  const updated = await updateThread(id, { archived: true })
  if (updated) {
    await broadcastToRoom(existing.roomId, {
      type: 'membership-removed',
      room_id: existing.roomId,
      payload: { thread: updated },
    })
  }
  setResponseStatus(event, 204)
  return null
})
