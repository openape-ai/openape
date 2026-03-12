import type { H3Event } from 'h3'
import { getRequestHost } from 'h3'
import { getOrg } from '../utils/org-store'

const mountedSlugs = new Set<string>()

function ensureTenantStorageMounted(slug: string) {
  if (mountedSlugs.has(slug)) return

  const config = useRuntimeConfig()
  const s3Config = config.s3AccessKey
    ? {
        driver: '@openape/unstorage-s3-driver',
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
        bucket: config.s3Bucket,
        endpoint: config.s3Endpoint,
        region: config.s3Region,
      }
    : null

  const idpKey = `tenant-idp-${slug}`
  const grantsKey = `tenant-grants-${slug}`

  if (s3Config) {
    useStorage().mount(idpKey, {
      ...s3Config,
      prefix: `orgs/${slug}/idp/`,
    } as any)
    useStorage().mount(grantsKey, {
      ...s3Config,
      prefix: `orgs/${slug}/grants/`,
    } as any)
  }
  else {
    // Local dev: fsLite
    useStorage().mount(idpKey, {
      driver: 'fsLite',
      base: `./.data/orgs/${slug}/idp`,
    } as any)
    useStorage().mount(grantsKey, {
      driver: 'fsLite',
      base: `./.data/orgs/${slug}/grants`,
    } as any)
  }

  mountedSlugs.add(slug)
}

export default defineEventHandler(async (event: H3Event) => {
  const slug = event.context.tenantSlug as string | null
  if (!slug) return

  const org = await getOrg(slug)
  if (!org) {
    throw createError({ statusCode: 404, statusMessage: `Organization "${slug}" not found` })
  }

  ensureTenantStorageMounted(slug)

  const host = event.context.isCustomDomain && event.context.customDomainHost
    ? (event.context.customDomainHost as string).split(':')[0]
    : getRequestHost(event).split(':')[0]

  const isHttps = host !== 'localhost' && !host.endsWith('.lvh.me') && host !== 'lvh.me'
  const origin = `${isHttps ? 'https' : 'http'}://${getRequestHost(event)}`

  // Set event context for nuxt-auth-idp
  event.context.openapeStorageKey = `tenant-idp-${slug}`
  event.context.openapeIssuer = `${isHttps ? 'https' : 'http'}://${host}`
  event.context.openapeRpConfig = {
    rpName: org.name,
    rpID: host,
    origin,
  }
  event.context.openapeAdminEmails = org.adminEmails
  event.context.openapeTenantSlug = slug

  // Set event context for nuxt-grants
  event.context.openapeGrantsStorageKey = `tenant-grants-${slug}`

  // Attach org for downstream use
  event.context.org = org
})
