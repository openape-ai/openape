import { cockpitOwner } from '../../utils/cockpit/auth'
import { loadChat } from '../../utils/cockpit/chat-store'

// The persistent conversation for one company — the client loads this on open
// and polls it (with ?since=) to catch answers that arrived while disconnected.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const q = getQuery(event)
  const company = String(q.company ?? '')
  if (!company) throw createError({ statusCode: 400, statusMessage: 'company required' })
  const since = Number(q.since ?? 0) || 0
  const rows = await loadChat(company, owner, since)
  return rows.map(m => ({ id: m.id, role: m.role, content: m.content, meta: m.meta ?? undefined, files: m.files ?? undefined, createdAt: m.createdAt }))
})
