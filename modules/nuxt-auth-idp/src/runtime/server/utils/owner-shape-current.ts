import type { OpenApeGrant } from '@openape/core'
import { ownerScopedShapeStore } from '@openape/grants'
import { createProblemError } from './problem'

/**
 * Refuses a grant resolved with an owner shape that changed since: removed,
 * republished with another digest, or taken over by a registry shape (issue
 * 1551). Every path that approves or issues a token for an existing grant
 * applies it, so a stale owner-shape approval cannot be used outside
 * `POST /api/grants/authorize` either. Grants without an owner shape pass
 * without reading the shape store.
 */
export async function assertOwnerShapeCurrent(grant: OpenApeGrant): Promise<void> {
  const context = grant.request.execution_context
  if (!context?.adapter_owner) return
  const { useShapeStore } = await import('./shape-store')
  const detail = grant.request.authorization_details?.find(detail => detail.type === 'openape_cli')
  const shape = detail?.type === 'openape_cli' ? await ownerScopedShapeStore(useShapeStore(), context.adapter_owner).getShape(detail.cli_id) : null
  if (shape?.owner !== context.adapter_owner || shape.digest !== context.adapter_digest)
    throw createProblemError({ status: 409, title: 'The owner shape this grant was approved for changed or was removed; request the command again', type: 'https://openape.org/errors/owner_shape_changed' })
}
