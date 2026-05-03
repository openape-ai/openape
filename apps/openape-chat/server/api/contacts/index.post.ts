import { z } from 'zod'
import { resolveCaller } from '../../utils/auth'
import { ensureDmRoomFor, projectForCaller, upsertRequest } from '../../utils/contacts'
import { broadcastToRoom } from '../../utils/realtime'

const bodySchema = z.object({
  email: z.string().email().toLowerCase(),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const peer = parsed.data.email
  if (peer === caller.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot add yourself as a contact' })
  }

  const { row, becameMutual } = await upsertRequest(caller.email, peer)
  if (becameMutual) {
    const roomId = await ensureDmRoomFor(row)
    // Notify both peers' open clients via the existing realtime channel
    // so the contacts list refreshes without polling.
    await broadcastToRoom(roomId, {
      type: 'membership-added',
      room_id: roomId,
      payload: { contact: projectForCaller(row, caller.email) },
    })
  }

  setResponseStatus(event, 201)
  return projectForCaller({ ...row, roomId: row.roomId }, caller.email)
})
