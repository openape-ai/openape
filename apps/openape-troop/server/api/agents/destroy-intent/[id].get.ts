import { requireOwner } from '../../../utils/auth'
import { getDestroyIntent } from '../../../utils/destroy-intents'

// GET /api/agents/destroy-intent/:id — UI polls this every ~2s after
// posting a destroy-intent. Mirrors spawn-intent/:id.get.ts:
//
//   200 { pending: true }                — nest hasn't replied yet
//   200 { pending: false, ok: true }     — destroy succeeded
//   200 { pending: false, ok: false, error } — nest reported failure
//   404                                  — unknown intent (pruned)
export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'missing intent id' })

  const intent = getDestroyIntent(id)
  if (!intent) throw createError({ statusCode: 404, statusMessage: 'intent not found' })

  if (!intent.result) return { pending: true }
  return {
    pending: false,
    ok: intent.result.ok,
    error: intent.result.error,
  }
})
