import { readBody, createError } from 'h3'
import { createOrg } from '../../../utils/org-store'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ slug: string, name: string, adminEmail: string }>(event)

  if (!body.slug || !body.name || !body.adminEmail) {
    throw createError({ statusCode: 400, statusMessage: 'slug, name, and adminEmail are required' })
  }

  const slug = body.slug.toLowerCase().trim()
  const adminEmail = body.adminEmail.toLowerCase().trim()

  let org
  try {
    org = await createOrg({
      slug,
      name: body.name.trim(),
      adminEmails: [adminEmail],
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create org'
    throw createError({ statusCode: 400, statusMessage: message })
  }

  // Create admin user in tenant storage via management token
  const config = useRuntimeConfig()
  const baseDomain = config.public.domain as string
  const isLocal = baseDomain.includes('lvh.me') || baseDomain.includes('localhost')
  const protocol = isLocal ? 'http' : 'https'
  const tenantOrigin = `${protocol}://${slug}.${baseDomain}`

  // Create admin user via the IdP module's admin API
  const mgmtToken = config.openapeIdp?.managementToken || process.env.NUXT_OPENAPE_MANAGEMENT_TOKEN
  if (mgmtToken) {
    try {
      await $fetch(`${tenantOrigin}/api/admin/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgmtToken}` },
        body: { email: adminEmail, name: body.name },
      })
    }
    catch {
      // User creation via internal fetch may fail in dev — the user will register via passkey
    }

    // Create registration URL for the admin
    try {
      const regResult = await $fetch<{ token: string }>(`${tenantOrigin}/api/admin/registration-urls`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mgmtToken}` },
        body: { email: adminEmail },
      })

      return {
        org,
        redirectUrl: `${tenantOrigin}/register?token=${regResult.token}`,
      }
    }
    catch {
      // Fallback: redirect to tenant without token
    }
  }

  return {
    org,
    redirectUrl: `${tenantOrigin}/register`,
  }
})
