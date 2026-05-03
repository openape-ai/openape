import { resolveCaller } from '../../../../utils/auth'
import { assertMember } from '../../../../utils/membership'
import { ensureMainThread, listThreadsInRoom } from '../../../../utils/threads'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing room id' })
  await assertMember(id, caller.email)

  // Lazy backfill for legacy rooms (created before Phase B): if there
  // are no threads, materialise a "main" thread that absorbs any
  // existing thread-less messages.
  const existing = await listThreadsInRoom(id)
  if (existing.length === 0) {
    await ensureMainThread({ roomId: id, createdByEmail: caller.email })
    return await listThreadsInRoom(id)
  }
  return existing
})
