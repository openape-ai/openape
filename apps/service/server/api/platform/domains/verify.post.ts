import { requireTenant } from '../../../utils/tenant'
import { getOrg, updateOrg } from '../../../utils/org-store'

export default defineEventHandler(async (event) => {
  const slug = requireTenant(event)
  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })
  if (!org.customDomain) throw createError({ statusCode: 400, statusMessage: 'No custom domain configured' })

  const config = useRuntimeConfig()
  if (!config.vercelApiToken || !config.vercelProjectId) {
    throw createError({ statusCode: 500, statusMessage: 'Vercel API not configured' })
  }

  // Check domain configuration via Vercel API
  try {
    const domain = await $fetch<{ verified: boolean, verification?: any[] }>(
      `https://api.vercel.com/v6/domains/${org.customDomain}/config`,
      {
        headers: { Authorization: `Bearer ${config.vercelApiToken}` },
        query: config.vercelTeamId ? { teamId: config.vercelTeamId } : undefined,
      },
    )

    if (domain.verified) {
      await updateOrg(slug, { customDomainVerified: true })
      return { verified: true, domain: org.customDomain }
    }

    return {
      verified: false,
      domain: org.customDomain,
      instructions: `Add a CNAME record: ${org.customDomain} → cname.vercel-dns.com`,
      verification: domain.verification,
    }
  }
  catch (err: any) {
    return {
      verified: false,
      domain: org.customDomain,
      error: err.message,
      instructions: `Add a CNAME record: ${org.customDomain} → cname.vercel-dns.com`,
    }
  }
})
