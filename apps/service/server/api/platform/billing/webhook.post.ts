import { readRawBody, getHeader } from 'h3'
import type Stripe from 'stripe'
import { updateOrg } from '../../../utils/org-store'
import { useStripe } from '../../../utils/billing'

export default defineEventHandler(async (event) => {
  const stripe = useStripe()
  const config = useRuntimeConfig()
  const sig = getHeader(event, 'stripe-signature')
  const rawBody = await readRawBody(event)

  if (!sig || !rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Missing signature or body' })
  }

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, config.stripeWebhookSecret as string)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid webhook signature' })
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      const slug = session.metadata?.orgSlug
      if (slug && session.subscription) {
        await updateOrg(slug, {
          plan: 'payg',
          stripeCustomerId: String(session.customer),
          stripeSubscriptionId: String(session.subscription),
        })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      const customerId = String(subscription.customer)
      // Find org by customer ID
      const { listOrgs } = await import('../../../utils/org-store')
      const orgs = await listOrgs()
      const org = orgs.find(o => o.stripeCustomerId === customerId)
      if (org) {
        await updateOrg(org.slug, {
          plan: 'free',
          stripeSubscriptionId: undefined,
        })
      }
      break
    }
  }

  return { received: true }
})
