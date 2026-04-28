import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requireYoloPolicyActor } from '../../../utils/yolo-policy-auth'
import { AUDIENCE_WILDCARD, useYoloPolicyStore } from '../../../utils/yolo-policy-store'

export default defineEventHandler(async (event) => {
  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) throw createProblemError({ status: 400, title: 'Email is required' })

  await requireYoloPolicyActor(event, email)

  const audience = (getQuery(event).audience as string | undefined)?.trim()
  // Modes:
  //   - no `audience` query: legacy callers — return the wildcard row.
  //   - `audience=*`: same as no param.
  //   - `audience=<specific>`: most-specific match for that audience with
  //     wildcard fallback. UI uses this when rendering bucket-scoped views.
  //   - `audience=__all__`: dump every per-agent row across all audiences.
  if (audience === '__all__') {
    const policies = await useYoloPolicyStore().listForAgent(email)
    return { policies }
  }
  const policy = await useYoloPolicyStore().get(email, audience || AUDIENCE_WILDCARD)
  return { policy }
})
