import { getSpawnIntent } from '../../../utils/spawn-intents'
import { requireOwner } from '../../../utils/auth'

// GET /api/agents/spawn-intent/:id — UI polls this every ~2s after
// posting a spawn-intent. Three possible response shapes:
//
//   200 { pending: true }                       — nest hasn't replied yet
//   200 { pending: false, ok: true,  agent_email }  — spawn succeeded
//   200 { pending: false, ok: false, error }    — nest reported failure
//   404                                         — unknown intent (pruned)
//
// Auth: owner-only. We don't bind intents to owner-email server-side
// (the in-memory map is keyed only by uuid), so any owner asking
// after their *own* intent-id will hit a record they themselves
// created milliseconds earlier. Cross-owner leakage is bounded by
// the unguessable UUID, but tightening this with an owner-bound map
// is a quick follow-up once we add a second owner.
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing intent id' })

  const intent = getSpawnIntent(id)
  if (!intent) throw createError({ statusCode: 404, statusMessage: 'intent not found' })

  if (!intent.result) return { pending: true }
  return {
    pending: false,
    ok: intent.result.ok,
    agent_email: intent.result.agentEmail,
    error: intent.result.error,
  }
})
