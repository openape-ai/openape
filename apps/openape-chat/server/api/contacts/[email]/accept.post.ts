import { resolveCaller } from '../../../utils/auth'
import { acceptRequest, ensureDmRoomFor, projectForCaller } from '../../../utils/contacts'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const peerEmailRaw = getRouterParam(event, 'email')
  if (!peerEmailRaw) throw createError({ statusCode: 400, statusMessage: 'Missing peer email' })
  const peerEmail = decodeURIComponent(peerEmailRaw).toLowerCase()

  const result = await acceptRequest(caller.email, peerEmail)
  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'No pending request from that peer' })
  }
  if (result.becameMutual) {
    await ensureDmRoomFor(result.row)
  }
  return projectForCaller(result.row, caller.email)
})
