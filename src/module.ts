import crypto from 'node:crypto'
import { defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, addComponentsDir, useLogger } from '@nuxt/kit'
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
  spId: string
  spName: string
  sessionSecret: string
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
    spId: '',
    spName: 'OpenApe Service Provider',
    sessionSecret: 'change-me-sp-secret-at-least-32-chars-long',
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

      if (!config.spId) {
        const port = nuxt.options.devServer?.port || 3000
        config.spId = `localhost:${port}`
        logger.info(`Auto-derived spId: ${config.spId}`)
      }
    }

    // Production warnings
    if (!nuxt.options.dev) {
      const config = nuxt.options.runtimeConfig.openapeSp as ModuleOptions
      if (config.sessionSecret === 'change-me-sp-secret-at-least-32-chars-long') {
        logger.warn('Using default sessionSecret in production! Set NUXT_OPENAPE_SP_SESSION_SECRET.')
      }
      if (!config.spId) {
        logger.warn('spId is empty in production! Set openapeSp.spId or NUXT_OPENAPE_SP_SP_ID.')
      }
    }

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
      addServerHandler({ route: '/.well-known/sp-manifest.json', handler: resolve('./runtime/server/routes/well-known/sp-manifest.json.get') })
      addServerHandler({ route: '/.well-known/auth.md', handler: resolve('./runtime/server/routes/well-known/auth.md.get') })
      addServerHandler({ route: '/.well-known/openape.json', handler: resolve('./runtime/server/routes/well-known/openape.json.get') })
    }
  },
})
