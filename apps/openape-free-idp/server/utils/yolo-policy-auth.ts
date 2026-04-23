// Session + ownership guard for YOLO-policy CRUD endpoints.
import type { H3Event } from 'h3'
// requireAuth, isAdmin, useIdpStores, createProblemError are auto-imported
// from @openape/nuxt-auth-idp via the module's addServerImportsDir.
//
// eslint-disable-next-line ts/ban-ts-comment
// @ts-ignore — provided at runtime by the module

export async function requireYoloPolicyActor(event: H3Event, agentEmail: string): Promise<string> {
  const caller = await requireAuth(event)

  const { userStore } = useIdpStores()
  const target = await userStore.findByEmail(agentEmail)
  if (!target) {
    throw createProblemError({ status: 404, title: 'Agent not found' })
  }
  if (target.type !== 'agent') {
    throw createProblemError({ status: 400, title: 'YOLO-Policies apply to agents only' })
  }

  if (caller === '_management_') return caller
  if (isAdmin(caller)) return caller
  if (caller === target.owner || caller === target.approver) return caller

  throw createProblemError({
    status: 403,
    title: 'Only the agent owner or approver may manage its YOLO-Policy',
  })
}
