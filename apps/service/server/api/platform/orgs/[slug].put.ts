import { readBody } from 'h3'
import { getOrg, updateOrg } from '../../../utils/org-store'
import { usePlatformStorage } from '../../../utils/platform-storage'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Slug required' })

  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })

  const body = await readBody<{ name?: string, adminEmails?: string[], customDomain?: string }>(event)

  const updates: Parameters<typeof updateOrg>[1] = {}

  if (body.name) updates.name = body.name.trim()
  if (body.adminEmails) updates.adminEmails = body.adminEmails.map(e => e.trim().toLowerCase())

  // Custom domain handling
  if (body.customDomain !== undefined) {
    const storage = usePlatformStorage()

    // Remove old domain mapping
    if (org.customDomain) {
      await storage.removeItem(`domain-map:${org.customDomain}`)
    }

    if (body.customDomain) {
      // Set new domain mapping
      await storage.setItem(`domain-map:${body.customDomain}`, slug)
      updates.customDomain = body.customDomain
      updates.customDomainVerified = false

      // Add domain to Vercel project
      const config = useRuntimeConfig()
      if (config.vercelApiToken && config.vercelProjectId) {
        try {
          await $fetch(`https://api.vercel.com/v10/projects/${config.vercelProjectId}/domains`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.vercelApiToken}` },
            query: config.vercelTeamId ? { teamId: config.vercelTeamId } : undefined,
            body: { name: body.customDomain },
          })
        }
        catch (err: any) {
          console.error('[custom-domain] Vercel API error:', err.message)
        }
      }
    }
    else {
      updates.customDomain = undefined
      updates.customDomainVerified = false
    }
  }

  const updated = await updateOrg(slug, updates)
  return updated
})
