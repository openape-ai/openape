import type { User } from '@openape/auth'
import type { OpenApeGrant } from '@openape/core'
import { GENERIC_OPERATION_ID, sameShapeTier, scopedShapeStore, shapeScopeOf } from '@openape/grants'
import { createProblemError } from './problem'

/** The human owner whose personal and domain shapes read an account's calls: its owner, or itself when human (issues 1551, 1553). */
export function shapeOwnerOf(account: Pick<User, 'email' | 'owner' | 'type'>): string | undefined {
  return account.owner ?? (account.type === 'agent' ? undefined : account.email)
}

/**
 * Refuses a grant whose shape no longer reads the requester's calls as
 * approved (issues 1551, 1553): a personal or domain shape that was removed,
 * republished with another digest, overridden by a more specific tier or is
 * no longer the requester's, and an IdP-wide shape a personal or domain shape
 * now overrides for the requester. Every path that approves or issues a token
 * for an existing grant applies it, so such an approval cannot be used outside
 * `POST /api/grants/authorize` either.
 */
export async function assertScopedShapeCurrent(grant: OpenApeGrant): Promise<void> {
  const context = grant.request.execution_context
  const tiered = !!(context?.adapter_owner || context?.adapter_domain)
  const found = grant.request.authorization_details?.find(detail => detail.type === 'openape_cli')
  const detail = found?.type === 'openape_cli' ? found : undefined
  // Brokered identities read IdP-wide shapes only, and an exact command names no shape.
  if (!tiered && (grant.brokered || !detail || detail.operation_id === GENERIC_OPERATION_ID)) return
  const [{ useShapeStore }, { useIdpStores }] = await Promise.all([import('./shape-store'), import('./stores')])
  const account = grant.brokered ? null : await useIdpStores().userStore.findByEmail(grant.request.requester)
  const scope = shapeScopeOf(account ? shapeOwnerOf(account) : undefined)
  const store = useShapeStore()
  const shape = detail ? await scopedShapeStore(store, scope).getShape(detail.cli_id) : null
  if (tiered) {
    if (!shape || (!shape.owner && !shape.domain) || !sameShapeTier(context, { adapter_owner: shape.owner, adapter_domain: shape.domain, adapter_digest: shape.digest }))
      throw createProblemError({ status: 409, title: 'The personal or domain shape this grant was approved for changed or was removed; request the command again', type: 'https://openape.org/errors/owner_shape_changed' })
    return
  }
  if (!detail || !await store.getShape(detail.cli_id)) return
  if (!shape || shape.owner || shape.domain)
    throw createProblemError({ status: 409, title: 'A personal or domain shape now overrides the IdP-wide shape this grant was approved for; request the command again', type: 'https://openape.org/errors/owner_shape_changed' })
}
