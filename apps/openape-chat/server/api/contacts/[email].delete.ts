import { resolveCaller } from '../../utils/auth'
import { deleteContact } from '../../utils/contacts'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const peerEmailRaw = getRouterParam(event, 'email')
  if (!peerEmailRaw) throw createError({ statusCode: 400, statusMessage: 'Missing peer email' })
  const peerEmail = decodeURIComponent(peerEmailRaw).toLowerCase()

  // Note: this removes the relationship from BOTH sides — the canonical
  // pair row is single, so a "I'm done with this contact" call cleanly
  // unfriends symmetrically. The DM room itself is left intact (a peer
  // can still reach it via direct URL); future cleanup work could mark
  // it archived. v1 keeps the data so accidental clicks aren't fatal.
  const removed = await deleteContact(caller.email, peerEmail)
  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: 'No such contact' })
  }
  setResponseStatus(event, 204)
  return null
})
