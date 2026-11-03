import { defineEventHandler, getRouterParam } from 'h3'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { removeOwnerShape } from '../../utils/owner-shapes'

/**
 * DELETE /api/shapes/:cliId
 *
 * Removes the signed-in human owner's own shape (issue 1551). Continuing
 * grants resolved with it stop being reused at once; exact-command grants
 * are untouched.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireBrokerOwner(event, true)
  return await removeOwnerShape(owner, decodeURIComponent(getRouterParam(event, 'cliId') ?? ''))
})
