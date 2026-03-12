import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function useStripe(): Stripe {
  if (!_stripe) {
    const config = useRuntimeConfig()
    _stripe = new Stripe(config.stripeSecretKey as string)
  }
  return _stripe
}

export async function createCheckoutSession(org: { slug: string, name: string, stripeCustomerId?: string }, returnHost: string): Promise<string> {
  const stripe = useStripe()
  const config = useRuntimeConfig()

  let customerId = org.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: org.name,
      metadata: { orgSlug: org.slug },
    })
    customerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      { price: config.stripePriceUserMonthly as string, quantity: 1 },
      { price: config.stripePriceAgentMonthly as string, quantity: 1 },
    ],
    success_url: `https://${returnHost}/dashboard/billing?success=true`,
    cancel_url: `https://${returnHost}/dashboard/billing?canceled=true`,
    metadata: { orgSlug: org.slug },
  })

  return session.url!
}

export async function createBillingPortalSession(stripeCustomerId: string, returnHost: string): Promise<string> {
  const stripe = useStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `https://${returnHost}/dashboard/billing`,
  })
  return session.url
}

export async function reportUsage(stripeSubscriptionId: string, userCount: number, agentCount: number): Promise<void> {
  const stripe = useStripe()
  const config = useRuntimeConfig()

  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)

  for (const item of subscription.items.data) {
    if (item.price.id === config.stripePriceUserMonthly) {
      const billableUsers = Math.max(0, userCount - 1) // First user free
      await stripe.subscriptionItems.createUsageRecord(item.id, {
        quantity: billableUsers,
        action: 'set',
      })
    }
    if (item.price.id === config.stripePriceAgentMonthly) {
      const billableAgents = Math.max(0, agentCount - 1) // First agent free
      await stripe.subscriptionItems.createUsageRecord(item.id, {
        quantity: billableAgents,
        action: 'set',
      })
    }
  }
}
