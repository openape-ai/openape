import { defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, extendPages } from '@nuxt/kit'
import { defu } from 'defu'

export interface ModuleOptions {
  sessionSecret: string
  managementToken: string
  adminEmails: string
  storageKey: string
  issuer: string
  rpName: string
  rpID: string
  rpOrigin: string
  requireUserVerification: boolean
  residentKey: 'preferred' | 'required' | 'discouraged'
  attestationType: 'none' | 'indirect' | 'direct' | 'enterprise'
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@openape/nuxt-auth-idp',
    configKey: 'openapeIdp',
  },
  defaults: {
    sessionSecret: 'change-me-to-a-real-secret-at-least-32-chars',
    managementToken: '',
    adminEmails: '',
    storageKey: 'openape-idp',
    issuer: '',
    rpName: '',
    rpID: '',
    rpOrigin: '',
    requireUserVerification: false,
    residentKey: 'preferred',
    attestationType: 'none',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Inject runtime config
    nuxt.options.runtimeConfig.openapeIdp = defu(
      nuxt.options.runtimeConfig.openapeIdp as Record<string, unknown> || {},
      options,
    ) as typeof options

    // Register server utils (auto-imported by Nitro)
    addServerImportsDir(resolve('./runtime/server/utils'))

    // Register composables (auto-imported by Vue)
    addImportsDir(resolve('./runtime/composables'))

    // CORS rules
    nuxt.options.routeRules = defu(nuxt.options.routeRules || {}, {
      '/.well-known/**': { cors: true },
      '/token': { cors: true },
    })

    // Pages (overridable by the consuming app)
    extendPages((pages) => {
      const modulePages = [
        { name: 'openape-login', path: '/login', file: resolve('./runtime/pages/login.vue') },
        { name: 'openape-register', path: '/register', file: resolve('./runtime/pages/register.vue') },
        { name: 'openape-account', path: '/account', file: resolve('./runtime/pages/account.vue') },
        { name: 'openape-admin', path: '/admin', file: resolve('./runtime/pages/admin.vue') },
      ]

      for (const page of modulePages) {
        if (!pages.some(p => p.path === page.path)) {
          pages.push(page)
        }
      }
    })

    // Server route handlers — Auth
    addServerHandler({ route: '/api/logout', method: 'post', handler: resolve('./runtime/server/api/logout.post') })
    addServerHandler({ route: '/api/me', handler: resolve('./runtime/server/api/me.get') })

    // Server route handlers — WebAuthn Registration
    addServerHandler({ route: '/api/webauthn/register/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/register/options.post') })
    addServerHandler({ route: '/api/webauthn/register/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/register/verify.post') })

    // Server route handlers — WebAuthn Login
    addServerHandler({ route: '/api/webauthn/login/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/login/options.post') })
    addServerHandler({ route: '/api/webauthn/login/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/login/verify.post') })

    // Server route handlers — WebAuthn Credentials (Device Management)
    addServerHandler({ route: '/api/webauthn/credentials', handler: resolve('./runtime/server/api/webauthn/credentials.get') })
    addServerHandler({ route: '/api/webauthn/credentials/add/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/credentials/add/options.post') })
    addServerHandler({ route: '/api/webauthn/credentials/add/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/credentials/add/verify.post') })
    addServerHandler({ route: '/api/webauthn/credentials/:id', method: 'delete', handler: resolve('./runtime/server/api/webauthn/credentials/[id].delete') })

    // Server route handlers — OAuth
    addServerHandler({ route: '/authorize', handler: resolve('./runtime/server/routes/authorize.get') })
    addServerHandler({ route: '/token', method: 'post', handler: resolve('./runtime/server/routes/token.post') })
    addServerHandler({ route: '/.well-known/jwks.json', handler: resolve('./runtime/server/routes/well-known/jwks.json.get') })

    // Server route handlers — Admin Users
    addServerHandler({ route: '/api/admin/users', handler: resolve('./runtime/server/api/admin/users/index.get') })
    addServerHandler({ route: '/api/admin/users', method: 'post', handler: resolve('./runtime/server/api/admin/users/index.post') })
    addServerHandler({ route: '/api/admin/users/:email', method: 'delete', handler: resolve('./runtime/server/api/admin/users/[email].delete') })
    addServerHandler({ route: '/api/admin/users/:email/credentials', handler: resolve('./runtime/server/api/admin/users/[email]/credentials.get') })

    // Server route handlers — Admin Agents
    addServerHandler({ route: '/api/admin/agents', handler: resolve('./runtime/server/api/admin/agents/index.get') })
    addServerHandler({ route: '/api/admin/agents', method: 'post', handler: resolve('./runtime/server/api/admin/agents/index.post') })
    addServerHandler({ route: '/api/admin/agents/:id', handler: resolve('./runtime/server/api/admin/agents/[id].get') })
    addServerHandler({ route: '/api/admin/agents/:id', method: 'put', handler: resolve('./runtime/server/api/admin/agents/[id].put') })
    addServerHandler({ route: '/api/admin/agents/:id', method: 'delete', handler: resolve('./runtime/server/api/admin/agents/[id].delete') })

    // Server route handlers — Admin Registration URLs
    addServerHandler({ route: '/api/admin/registration-urls', handler: resolve('./runtime/server/api/admin/registration-urls/index.get') })
    addServerHandler({ route: '/api/admin/registration-urls', method: 'post', handler: resolve('./runtime/server/api/admin/registration-urls/index.post') })
    addServerHandler({ route: '/api/admin/registration-urls/:token', method: 'delete', handler: resolve('./runtime/server/api/admin/registration-urls/[token].delete') })
  },
})
