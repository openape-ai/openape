import { defineEventHandler } from 'h3'
import { GRANTS_READ_SCOPE } from '@openape/core'
import { isStandingGrantRequest } from '@openape/grants'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { tryGrantsDelegate } from '../../utils/grants-delegation'

/**
 * GET /api/standing-grants
 *
 * Returns all standing grants owned by the logged-in user, or by the user
 * who gave the caller a `grants:read` delegation. Includes expired and
 * revoked ones — callers filter by status client-side if they only want
 * active pre-auths.
 */
export default defineEventHandler(async (event) => {
  const owner = (await tryGrantsDelegate(event, GRANTS_READ_SCOPE))?.delegator ?? await requireAuth(event)
  const { grantStore } = useGrantStores()
  // Standing grants are stored with requester=delegate, so listGrants
  // with a status filter + type=standing + owner-check in JS is the
  // cheapest way to get a user's own pre-auths.
  const all = await grantStore.listGrants({})
  return all.data.filter((g) => {
    if (g.type !== 'standing') return false
    if (!isStandingGrantRequest(g.request)) return false
    return g.request.owner === owner
  })
})
