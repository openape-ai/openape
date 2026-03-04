import crypto from 'node:crypto'
import { defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, addComponentsDir, useLogger } from '@nuxt/kit'
import { defu } from 'defu'

export interface ModuleOptions {
  spId: string
  spName: string
  sessionSecret: string
  openapeUrl: string
  fallbackIdpUrl: string
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

    // Register server handlers directly.
    // All handlers use explicit h3 imports so they work with or without auto-imports.
    // Consumer projects should add @openape/nuxt-auth-sp to nitro.externals.inline
    // and set nitro.imports.autoImport = false for reliable Vercel deployments.
    addServerHandler({ route: '/api/login', method: 'post', handler: resolve('./runtime/server/api/login.post') })
    addServerHandler({ route: '/api/callback', handler: resolve('./runtime/server/api/callback.get') })
    addServerHandler({ route: '/api/logout', method: 'post', handler: resolve('./runtime/server/api/logout.post') })
    addServerHandler({ route: '/api/me', handler: resolve('./runtime/server/api/me.get') })
    addServerHandler({ route: '/.well-known/sp-manifest.json', handler: resolve('./runtime/server/routes/well-known/sp-manifest.json.get') })
  },
})
