import { requireOwnedOrg } from '../../../utils/orgs'

export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  return org
})
