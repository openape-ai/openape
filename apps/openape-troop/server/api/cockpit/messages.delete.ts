import { cockpitOwner } from '../../utils/cockpit/auth'
import { deleteChat } from '../../utils/cockpit/chat-store'

// Clear a company's conversation (owner-scoped).
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const company = String(getQuery(event).company ?? '')
  if (!company) throw createError({ statusCode: 400, statusMessage: 'company required' })
  await deleteChat(company, owner)
  return { ok: true }
})
