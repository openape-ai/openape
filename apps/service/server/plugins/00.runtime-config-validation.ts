function valueAtPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object')
      return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production')
    return

  const config = useRuntimeConfig() as unknown as Record<string, unknown>

  const requiredPaths = [
    'openapeIdp.sessionSecret',
    'openapeIdp.managementToken',
    'platformAdminEmails',
  ]

  const stripePaths = [
    'stripeSecretKey',
    'stripeWebhookSecret',
    'stripePriceUserMonthly',
    'stripePriceAgentMonthly',
  ]

  // Billing integration is optional. If any Stripe value is configured,
  // require all Stripe values to avoid partial misconfiguration.
  const stripeEnabled = stripePaths.some((path) => {
    const value = valueAtPath(config, path)
    return typeof value === 'string' && value.trim().length > 0
  })
  if (stripeEnabled)
    requiredPaths.push(...stripePaths)

  const missing = requiredPaths.filter((path) => {
    const value = valueAtPath(config, path)
    return typeof value !== 'string' || value.trim().length === 0
  })

  if (missing.length > 0) {
    throw new Error(`Missing required runtime config values: ${missing.join(', ')}`)
  }
})
