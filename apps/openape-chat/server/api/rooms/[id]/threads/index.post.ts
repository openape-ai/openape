import { z } from 'zod'
import { resolveCaller } from '../../../../utils/auth'
import { assertMember } from '../../../../utils/membership'
import { createThread } from '../../../../utils/threads'
import { broadcastToRoom } from '../../../../utils/realtime'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })
  await assertMember(id, caller.email)

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const thread = await createThread({
    roomId: id,
    name: parsed.data.name,
    createdByEmail: caller.email,
  })
  // Reuse the existing membership-* event channel so peers refresh
  // their thread list without polling.
  await broadcastToRoom(id, { type: 'membership-changed', room_id: id, payload: { thread } })
  setResponseStatus(event, 201)
  return thread
})
