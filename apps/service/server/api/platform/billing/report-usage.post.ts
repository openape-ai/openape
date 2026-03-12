import { getHeader } from 'h3'
import { listOrgs } from '../../../utils/org-store'
import { reportUsage } from '../../../utils/billing'

export default defineEventHandler(async (event) => {
  // Vercel Cron sends Authorization header — verify it's a cron job or management token
  const config = useRuntimeConfig()
  const auth = getHeader(event, 'Authorization')
  const cronSecret = getHeader(event, 'x-vercel-cron-secret')

  // In production, only allow Vercel Cron or management token
  if (!cronSecret && auth !== `Bearer ${config.openapeIdp?.managementToken}`) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const orgs = await listOrgs()
  const results: { slug: string, ok: boolean, error?: string }[] = []

  for (const org of orgs) {
    if (org.plan !== 'payg' || !org.stripeSubscriptionId) continue

    try {
      // Get user and agent counts from tenant storage
      const idpStorage = useStorage(`tenant-idp-${org.slug}`)
      const userKeys = await idpStorage.getKeys('users:')
      const agentKeys = await idpStorage.getKeys('agents:')

      await reportUsage(org.stripeSubscriptionId, userKeys.length, agentKeys.length)
      results.push({ slug: org.slug, ok: true })
    }
    catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      results.push({ slug: org.slug, ok: false, error })
    }
  }

  return { reported: results.length, results }
})
