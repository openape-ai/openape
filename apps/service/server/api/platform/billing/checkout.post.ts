import { getRequestHost } from 'h3'
import { createCheckoutSession } from '../../../utils/billing'
import { requireTenant } from '../../../utils/tenant'
import { getOrg, updateOrg } from '../../../utils/org-store'

export default defineEventHandler(async (event) => {
  const slug = requireTenant(event)
  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })

  const host = getRequestHost(event)
  const url = await createCheckoutSession(org, host)

  // Save Stripe customer ID if newly created
  if (!org.stripeCustomerId) {
    // The customer was created inside createCheckoutSession — retrieve from Stripe
    const stripe = useStripe()
    const sessions = await stripe.checkout.sessions.list({ limit: 1 })
    const session = sessions.data[0]
    if (session?.customer) {
      await updateOrg(slug, { stripeCustomerId: session.customer as string })
    }
  }

  return { url }
})
