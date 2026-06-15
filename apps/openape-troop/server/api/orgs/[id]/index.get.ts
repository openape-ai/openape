import { requireOwnedOrg } from '../../../utils/orgs'

// Org detail (owner-only). Ported from openape-org (B0).
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  return org
})
