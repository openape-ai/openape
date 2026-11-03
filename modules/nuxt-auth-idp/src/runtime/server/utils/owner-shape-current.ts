import type { User } from '@openape/auth'
import type { OpenApeGrant } from '@openape/core'
import { sameShapeTier, scopedShapeStore, shapeScopeOf } from '@openape/grants'
import { createProblemError } from './problem'

/** The human owner whose personal and domain shapes read an account's calls: its owner, or itself when human (issues 1551, 1553). */
export function shapeOwnerOf(account: Pick<User, 'email' | 'owner' | 'type'>): string | undefined {
  return account.owner ?? (account.type === 'agent' ? undefined : account.email)
}

/**
 * Refuses a grant resolved with a personal or domain shape that changed
 * since: removed, republished with another digest, overridden by a more
 * specific tier, or no longer the requester's (issues 1551, 1553). Every path
 * that approves or issues a token for an existing grant applies it, so a stale
 * approval cannot be used outside `POST /api/grants/authorize` either. Grants
 * without such a shape pass without reading the shape store.
 */
export async function assertScopedShapeCurrent(grant: OpenApeGrant): Promise<void> {
  const context = grant.request.execution_context
  if (!context?.adapter_owner && !context?.adapter_domain) return
  const [{ useShapeStore }, { useIdpStores }] = await Promise.all([import('./shape-store'), import('./stores')])
  const detail = grant.request.authorization_details?.find(detail => detail.type === 'openape_cli')
  const account = grant.brokered ? null : await useIdpStores().userStore.findByEmail(grant.request.requester)
  const scope = shapeScopeOf(account ? shapeOwnerOf(account) : undefined)
  const shape = detail?.type === 'openape_cli' ? await scopedShapeStore(useShapeStore(), scope).getShape(detail.cli_id) : null
  if (!shape || (!shape.owner && !shape.domain) || !sameShapeTier(context, { adapter_owner: shape.owner, adapter_domain: shape.domain, adapter_digest: shape.digest }))
    throw createProblemError({ status: 409, title: 'The personal or domain shape this grant was approved for changed or was removed; request the command again', type: 'https://openape.org/errors/owner_shape_changed' })
}
