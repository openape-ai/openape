import { defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, extendPages } from '@nuxt/kit'
import { defu } from 'defu'

export interface GrantsOptions {
  enablePages: boolean
  storageKey: string
}

export interface RoutesOptions {
  auth: boolean
  oauth: boolean
  grants: boolean
  admin: boolean
  agent: boolean
}

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
  grants: Partial<GrantsOptions>
  routes: boolean | Partial<RoutesOptions>
  pages: boolean
  /** Federation providers as JSON string (parsed at runtime) */
  federationProviders: string
}

function resolveRoutes(routes: boolean | Partial<RoutesOptions> | undefined): RoutesOptions {
  if (routes === false)
    return { auth: false, oauth: false, grants: false, admin: false, agent: false }
  if (routes === true || routes === undefined)
    return { auth: true, oauth: true, grants: true, admin: true, agent: true }
  return {
    auth: routes.auth !== false,
    oauth: routes.oauth !== false,
    grants: routes.grants !== false,
    admin: routes.admin !== false,
    agent: routes.agent !== false,
  }
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
    grants: {
      enablePages: true,
      storageKey: 'openape-grants',
    },
    routes: true,
    pages: true,
    federationProviders: '',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const routeConfig = resolveRoutes(options.routes)

    // Resolve grants options (defaults always filled by defineNuxtModule)
    const legacyGrantsConfig = (nuxt.options as unknown as Record<string, unknown>).openapeGrants as Partial<GrantsOptions> | undefined
    const grants: GrantsOptions = {
      enablePages: legacyGrantsConfig?.enablePages ?? options.grants.enablePages ?? true,
      storageKey: legacyGrantsConfig?.storageKey ?? options.grants.storageKey ?? 'openape-grants',
    }

    // Inject runtime config — IdP (defaults ensure all fields are populated)
    nuxt.options.runtimeConfig.openapeIdp = defu(
      nuxt.options.runtimeConfig.openapeIdp as Record<string, unknown> || {},
      options,
    ) as typeof nuxt.options.runtimeConfig.openapeIdp

    // Inject runtime config — Grants
    nuxt.options.runtimeConfig.openapeGrants = defu(
      nuxt.options.runtimeConfig.openapeGrants as Record<string, unknown> || {},
      { storageKey: grants.storageKey },
    ) as { storageKey: string }

    // Register server utils (auto-imported by Nitro)
    addServerImportsDir(resolve('./runtime/server/utils'))

    // Register composables (auto-imported by Vue)
    addImportsDir(resolve('./runtime/composables'))

    // Security headers
    const securityHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': 'frame-ancestors \'none\'',
    }

    // CORS rules
    const corsRules: Record<string, { cors?: boolean, headers?: Record<string, string> }> = {
      '/**': { headers: securityHeaders },
    }
    if (routeConfig.oauth) {
      corsRules['/.well-known/**'] = { cors: true }
      corsRules['/token'] = { cors: true }
    }
    if (routeConfig.grants)
      corsRules['/api/grants/**'] = { cors: true }
    if (routeConfig.agent)
      corsRules['/api/agent/**'] = { cors: true }
    nuxt.options.routeRules = defu(nuxt.options.routeRules || {}, corsRules)

    // Pages (overridable by the consuming app)
    if (options.pages !== false) {
      extendPages((pages) => {
        const modulePages = [
          { name: 'openape-login', path: '/login', file: resolve('./runtime/pages/login.vue') },
          { name: 'openape-register', path: '/register', file: resolve('./runtime/pages/register.vue') },
          { name: 'openape-account', path: '/account', file: resolve('./runtime/pages/account.vue') },
          { name: 'openape-admin', path: '/admin', file: resolve('./runtime/pages/admin.vue') },
        ]

        if (grants.enablePages) {
          modulePages.push(
            { name: 'openape-grant-approval', path: '/grant-approval', file: resolve('./runtime/pages/grant-approval.vue') },
            { name: 'openape-grants', path: '/grants', file: resolve('./runtime/pages/grants.vue') },
            { name: 'openape-enroll', path: '/enroll', file: resolve('./runtime/pages/enroll.vue') },
          )
        }

        for (const page of modulePages) {
          if (!pages.some(p => p.path === page.path)) {
            pages.push(page)
          }
        }
      })
    }

    // Server route handlers — Auth
    if (routeConfig.auth) {
      addServerHandler({ route: '/api/logout', method: 'post', handler: resolve('./runtime/server/api/logout.post') })
      addServerHandler({ route: '/api/me', handler: resolve('./runtime/server/api/me.get') })

      // WebAuthn Registration
      addServerHandler({ route: '/api/webauthn/register/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/register/options.post') })
      addServerHandler({ route: '/api/webauthn/register/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/register/verify.post') })

      // WebAuthn Login
      addServerHandler({ route: '/api/webauthn/login/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/login/options.post') })
      addServerHandler({ route: '/api/webauthn/login/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/login/verify.post') })

      // WebAuthn Credentials (Device Management)
      addServerHandler({ route: '/api/webauthn/credentials', handler: resolve('./runtime/server/api/webauthn/credentials.get') })
      addServerHandler({ route: '/api/webauthn/credentials/add/options', method: 'post', handler: resolve('./runtime/server/api/webauthn/credentials/add/options.post') })
      addServerHandler({ route: '/api/webauthn/credentials/add/verify', method: 'post', handler: resolve('./runtime/server/api/webauthn/credentials/add/verify.post') })
      addServerHandler({ route: '/api/webauthn/credentials/:id', method: 'delete', handler: resolve('./runtime/server/api/webauthn/credentials/[id].delete') })
    }

    // Server route handlers — OAuth
    if (routeConfig.oauth) {
      addServerHandler({ route: '/authorize', handler: resolve('./runtime/server/routes/authorize.get') })
      addServerHandler({ route: '/token', method: 'post', handler: resolve('./runtime/server/routes/token.post') })
      addServerHandler({ route: '/revoke', method: 'post', handler: resolve('./runtime/server/routes/revoke.post') })
      addServerHandler({ route: '/.well-known/jwks.json', handler: resolve('./runtime/server/routes/well-known/jwks.json.get') })
      addServerHandler({ route: '/.well-known/openid-configuration', handler: resolve('./runtime/server/routes/well-known/openid-configuration.get') })
    }

    // Server route handlers — Admin
    if (routeConfig.admin) {
      // Admin Users
      addServerHandler({ route: '/api/admin/users', handler: resolve('./runtime/server/api/admin/users/index.get') })
      addServerHandler({ route: '/api/admin/users', method: 'post', handler: resolve('./runtime/server/api/admin/users/index.post') })
      addServerHandler({ route: '/api/admin/users/:email', method: 'delete', handler: resolve('./runtime/server/api/admin/users/[email].delete') })
      addServerHandler({ route: '/api/admin/users/:email/credentials', handler: resolve('./runtime/server/api/admin/users/[email]/credentials.get') })

      // Admin Agents
      addServerHandler({ route: '/api/admin/agents', handler: resolve('./runtime/server/api/admin/agents/index.get') })
      addServerHandler({ route: '/api/admin/agents', method: 'post', handler: resolve('./runtime/server/api/admin/agents/index.post') })
      addServerHandler({ route: '/api/admin/agents/:id', handler: resolve('./runtime/server/api/admin/agents/[id].get') })
      addServerHandler({ route: '/api/admin/agents/:id', method: 'put', handler: resolve('./runtime/server/api/admin/agents/[id].put') })
      addServerHandler({ route: '/api/admin/agents/:id', method: 'delete', handler: resolve('./runtime/server/api/admin/agents/[id].delete') })

      // Admin Sessions
      addServerHandler({ route: '/api/admin/sessions', handler: resolve('./runtime/server/api/admin/sessions/index.get') })
      addServerHandler({ route: '/api/admin/sessions/:familyId', method: 'delete', handler: resolve('./runtime/server/api/admin/sessions/[familyId].delete') })
      addServerHandler({ route: '/api/admin/sessions/user/:email', method: 'delete', handler: resolve('./runtime/server/api/admin/sessions/user/[email].delete') })

      // Admin Registration URLs
      addServerHandler({ route: '/api/admin/registration-urls', handler: resolve('./runtime/server/api/admin/registration-urls/index.get') })
      addServerHandler({ route: '/api/admin/registration-urls', method: 'post', handler: resolve('./runtime/server/api/admin/registration-urls/index.post') })
      addServerHandler({ route: '/api/admin/registration-urls/:token', method: 'delete', handler: resolve('./runtime/server/api/admin/registration-urls/[token].delete') })
    }

    // Server route handlers — Grants
    if (routeConfig.grants) {
      addServerHandler({ route: '/api/grants', handler: resolve('./runtime/server/api/grants/index.get') })
      addServerHandler({ route: '/api/grants', method: 'post', handler: resolve('./runtime/server/api/grants/index.post') })
      addServerHandler({ route: '/api/grants/verify', method: 'post', handler: resolve('./runtime/server/api/grants/verify.post') })
      addServerHandler({ route: '/api/grants/:id', handler: resolve('./runtime/server/api/grants/[id].get') })
      addServerHandler({ route: '/api/grants/:id/approve', method: 'post', handler: resolve('./runtime/server/api/grants/[id]/approve.post') })
      addServerHandler({ route: '/api/grants/:id/deny', method: 'post', handler: resolve('./runtime/server/api/grants/[id]/deny.post') })
      addServerHandler({ route: '/api/grants/:id/revoke', method: 'post', handler: resolve('./runtime/server/api/grants/[id]/revoke.post') })
      addServerHandler({ route: '/api/grants/:id/token', method: 'post', handler: resolve('./runtime/server/api/grants/[id]/token.post') })
      addServerHandler({ route: '/api/grants/:id/consume', method: 'post', handler: resolve('./runtime/server/api/grants/[id]/consume.post') })
    }

    // Server route handlers — Agent
    if (routeConfig.agent) {
      addServerHandler({ route: '/api/agent/challenge', method: 'post', handler: resolve('./runtime/server/api/agent/challenge.post') })
      addServerHandler({ route: '/api/agent/authenticate', method: 'post', handler: resolve('./runtime/server/api/agent/authenticate.post') })
      addServerHandler({ route: '/api/agent/enroll', method: 'post', handler: resolve('./runtime/server/api/agent/enroll.post') })
    }

    // Server route handlers — Federation
    if (routeConfig.auth) {
      addServerHandler({ route: '/auth/federated/:providerId', handler: resolve('./runtime/server/routes/auth/federated/[providerId].get') })
      addServerHandler({ route: '/auth/federated/:providerId/callback', handler: resolve('./runtime/server/routes/auth/federated/[providerId].callback.get') })
      addServerHandler({ route: '/api/federation/providers', handler: resolve('./runtime/server/api/federation/providers.get') })
    }
  },
})
