import crypto from 'node:crypto'
import { addServerPlugin, defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, addComponentsDir, useLogger } from '@nuxt/kit'
import { defu } from 'defu'

export interface ManifestConfig {
  service?: {
    name?: string
    description?: string
    url?: string
    icon?: string
    privacy_policy?: string
    terms?: string
    contact?: string
  }
  auth?: {
    ddisa_domain?: string
    oidc_client_id?: string
    supported_methods?: ('ddisa' | 'oidc')[]
    login_url?: string
  }
  scopes?: Record<string, {
    name: string
    description: string
    risk: 'low' | 'medium' | 'high' | 'critical'
    category?: string
    parameters?: Record<string, { type: string, description: string }>
  }>
  categories?: Record<string, { name: string, icon?: string }>
  policies?: {
    agent_access?: string
    delegation?: 'allowed' | 'denied'
    max_delegation_duration?: string | null
    require_grant_for_risk?: Record<string, string | null>
    require_mfa_for_risk?: Record<string, boolean>
  }
  rate_limits?: Record<string, Record<string, number>>
  endpoints?: {
    api_base?: string
    openapi?: string
    grant_verify?: string
  }
}

export interface ModuleOptions {
  clientId: string
  spName: string
  sessionSecret: string
  /**
   * Logged-in session cookie lifetime in seconds. Default: 7 days.
   * iOS Safari aggressively evicts session cookies (no explicit expiry),
   * so an explicit `maxAge` is what keeps users signed in on mobile.
   * Env: `NUXT_OPENAPE_SP_SESSION_MAX_AGE`.
   */
  sessionMaxAge: number
  openapeUrl: string
  fallbackIdpUrl: string
  routes: boolean
  manifest?: ManifestConfig
}

const logger = useLogger('@openape/nuxt-auth-sp')

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@openape/nuxt-auth-sp',
    configKey: 'openapeSp',
  },
  defaults: {
    clientId: '',
    spName: 'OpenApe Service Provider',
    sessionSecret: 'change-me-sp-secret-at-least-32-chars-long',
    sessionMaxAge: 60 * 60 * 24 * 7, // 7 days
    openapeUrl: '',
    fallbackIdpUrl: 'https://id.openape.at',
    routes: true,
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const runtimeDir = resolve('./runtime')

    // Inject runtime config (app values override module defaults)
    nuxt.options.runtimeConfig.openapeSp = defu(
      nuxt.options.runtimeConfig.openapeSp as Record<string, unknown> || {},
      options,
    ) as typeof options

    // Dev-mode auto-defaults
    if (nuxt.options.dev) {
      const config = nuxt.options.runtimeConfig.openapeSp as ModuleOptions

      if (!config.sessionSecret || config.sessionSecret === 'change-me-sp-secret-at-least-32-chars-long') {
        config.sessionSecret = crypto.randomUUID() + crypto.randomUUID()
        logger.info('Auto-generated sessionSecret for dev mode')
      }

      if (!config.clientId) {
        const port = nuxt.options.devServer?.port || 3000
        config.clientId = `localhost:${port}`
        logger.info(`Auto-derived clientId: ${config.clientId}`)
      }
    }

    // Production warnings
    if (!nuxt.options.dev) {
      const config = nuxt.options.runtimeConfig.openapeSp as ModuleOptions
      if (config.sessionSecret === 'change-me-sp-secret-at-least-32-chars-long') {
        logger.warn('Using default sessionSecret in production! Set NUXT_OPENAPE_SP_SESSION_SECRET.')
      }
      if (!config.clientId) {
        logger.warn('clientId is empty in production! Set openapeSp.clientId or NUXT_OPENAPE_SP_CLIENT_ID.')
      }
    }

    // RFC 7807 Problem Details error formatting
    addServerPlugin(resolve('./runtime/server/plugins/problem-details'))

    // Register server utils (available via #imports or auto-import)
    addServerImportsDir(resolve('./runtime/server/utils'))

    // Register composables (auto-imported by Vue)
    addImportsDir(resolve('./runtime/composables'))

    // Register components (auto-imported by Vue)
    addComponentsDir({ path: resolve(runtimeDir, 'components') })

    // Register server handlers directly (opt-out with routes: false).
    // All handlers use explicit h3 imports so they work with or without auto-imports.
    // Consumer projects should add @openape/nuxt-auth-sp to nitro.externals.inline
    // and set nitro.imports.autoImport = false for reliable Vercel deployments.
    if (options.routes !== false) {
      addServerHandler({ route: '/api/login', method: 'post', handler: resolve('./runtime/server/api/login.post') })
      addServerHandler({ route: '/api/callback', handler: resolve('./runtime/server/api/callback.get') })
      addServerHandler({ route: '/api/logout', method: 'post', handler: resolve('./runtime/server/api/logout.post') })
      addServerHandler({ route: '/api/me', handler: resolve('./runtime/server/api/me.get') })
      addServerHandler({ route: '/.well-known/oauth-client-metadata', handler: resolve('./runtime/server/routes/well-known/oauth-client-metadata.get') })
      addServerHandler({ route: '/.well-known/auth.md', handler: resolve('./runtime/server/routes/well-known/auth.md.get') })
      addServerHandler({ route: '/.well-known/openape.json', handler: resolve('./runtime/server/routes/well-known/openape.json.get') })
    }
  },
})
