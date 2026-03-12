import { getRequestHost } from 'h3'
import { createBillingPortalSession } from '../../../utils/billing'
import { requireTenant } from '../../../utils/tenant'
import { getOrg } from '../../../utils/org-store'

export default defineEventHandler(async (event) => {
  const slug = requireTenant(event)
  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })
  if (!org.stripeCustomerId) throw createError({ statusCode: 400, statusMessage: 'No billing account' })

  const host = getRequestHost(event)
  const url = await createBillingPortalSession(org.stripeCustomerId, host)
  return { url }
})
