import { addServerPlugin, defineNuxtModule, createResolver, addServerHandler, addImportsDir, addServerImportsDir, extendPages } from '@nuxt/kit'
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
  /** Session cookie max age in seconds (default: 604800 = 7 days) */
  sessionMaxAge: number
  managementToken: string
  adminEmails: string
  storageKey: string
  issuer: string
  rpName: string
  rpID: string
  rpOrigin: string
  rpHostAllowList: string
  requireUserVerification: boolean
  residentKey: 'preferred' | 'required' | 'discouraged'
  attestationType: 'none' | 'indirect' | 'direct' | 'enterprise'
  grants: Partial<GrantsOptions>
  routes: boolean | Partial<RoutesOptions>
  pages: boolean
  /** Federation providers as JSON string (parsed at runtime) */
  federationProviders: string
  /**
   * Space-separated list of origins allowed to embed this IdP in an iframe.
   * When empty (default), the IdP sends `X-Frame-Options: DENY` and
   * `Content-Security-Policy: frame-ancestors 'none'`.
   * When set (e.g. `"https://arrival.space https://app.example.com"`),
   * it sends `frame-ancestors 'self' <origins>` and drops X-Frame-Options
   * (which cannot express multiple origins).
   *
   * Env: `NUXT_OPENAPE_IDP_ALLOWED_FRAME_ANCESTORS`
   */
  allowedFrameAncestors: string
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
    sessionMaxAge: 60 * 60 * 24 * 7, // 7 days
    managementToken: '',
    adminEmails: '',
    storageKey: 'openape-idp',
    issuer: '',
    rpName: '',
    rpID: '',
    rpOrigin: '',
    rpHostAllowList: '',
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
    allowedFrameAncestors: '',
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

    // RFC 7807 Problem Details error formatting
    addServerPlugin(resolve('./runtime/server/plugins/problem-details'))

    // Register server utils (auto-imported by Nitro)
    addServerImportsDir(resolve('./runtime/server/utils'))

    // Register composables (auto-imported by Vue)
    addImportsDir(resolve('./runtime/composables'))

    // Security headers
    // routeRules are build-time config, so we read the env var directly
    // (Nuxt's NUXT_OPENAPE_IDP_* → runtimeConfig mapping only applies at
    // request time, which is too late for static route headers).
    const frameAncestors = (process.env.NUXT_OPENAPE_IDP_ALLOWED_FRAME_ANCESTORS || options.allowedFrameAncestors).trim()
    const securityHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    }
    if (frameAncestors) {
      // When specific origins are allowed, use CSP frame-ancestors only.
      // X-Frame-Options is dropped because it cannot express multiple
      // origins and is superseded by CSP frame-ancestors in modern browsers.
      securityHeaders['Content-Security-Policy'] = `frame-ancestors 'self' ${frameAncestors}`
    }
    else {
      securityHeaders['X-Frame-Options'] = 'DENY'
      securityHeaders['Content-Security-Policy'] = 'frame-ancestors \'none\''
    }

    const noCacheHeaders: Record<string, string> = {
      ...securityHeaders,
      'Cache-Control': 'no-store',
    }

    // CORS rules
    const corsRules: Record<string, { cors?: boolean, headers?: Record<string, string> }> = {
      '/**': { headers: securityHeaders },
      '/api/session/**': { headers: noCacheHeaders },
      '/api/logout': { headers: noCacheHeaders },
      '/api/me': { headers: noCacheHeaders },
      '/api/webauthn/**': { headers: noCacheHeaders },
      '/authorize': { headers: noCacheHeaders },
      '/token': { headers: noCacheHeaders },
      '/userinfo': { headers: noCacheHeaders },
      '/api/auth/**': { headers: noCacheHeaders },
      '/api/agent/**': { headers: noCacheHeaders },
      '/api/admin/**': { headers: noCacheHeaders },
    }
    if (routeConfig.oauth) {
      corsRules['/.well-known/**'] = { cors: true, headers: { ...securityHeaders, 'Cache-Control': 'public, max-age=3600' } }
      corsRules['/token'] = { cors: true }
      corsRules['/userinfo'] = { cors: true }
    }
    if (routeConfig.grants) {
      corsRules['/api/grants/**'] = { cors: true }
      corsRules['/api/delegations/**'] = { cors: true }
    }
    if (routeConfig.agent) {
      corsRules['/api/agent/**'] = { cors: true }
      corsRules['/api/auth/**'] = { cors: true, headers: noCacheHeaders }
    }
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
            // Phase 2: Agents view + standing-grant management
            { name: 'openape-agents', path: '/agents', file: resolve('./runtime/pages/agents.vue') },
            { name: 'openape-agents-detail', path: '/agents/:email', file: resolve('./runtime/pages/agents/[email].vue') },
          )
        }

        for (const page of modulePages) {
          if (!pages.some(p => p.path === page.path)) {
            pages.push(page)
          }
        }
      })
    }

    // CORS preflight handling for OPTIONS requests
    addServerPlugin(resolve('./runtime/server/plugins/cors-preflight'))

    // Signing key initialization (ensure JWKS is never empty)
    addServerPlugin(resolve('./runtime/server/plugins/init-signing-key'))

    // Rate limiting plugin
    addServerPlugin(resolve('./runtime/server/plugins/rate-limit'))

    // Server route handlers — Auth
    if (routeConfig.auth) {
      addServerHandler({ route: '/api/logout', method: 'post', handler: resolve('./runtime/server/api/logout.post') })
      addServerHandler({ route: '/api/session/login', method: 'post', handler: resolve('./runtime/server/api/session/login.post') })
      addServerHandler({ route: '/api/session/logout', method: 'post', handler: resolve('./runtime/server/api/session/logout.post') })
      addServerHandler({ route: '/api/session/ssh-keys', handler: resolve('./runtime/server/api/session/ssh-keys.get') })
      addServerHandler({ route: '/api/session/ssh-keys', method: 'post', handler: resolve('./runtime/server/api/session/ssh-keys.post') })
      addServerHandler({ route: '/api/session/ssh-keys/:keyId', method: 'delete', handler: resolve('./runtime/server/api/session/ssh-keys/[keyId].delete') })
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
      addServerHandler({ route: '/userinfo', handler: resolve('./runtime/server/routes/userinfo.get') })
    }

    // Server route handlers — Admin
    if (routeConfig.admin) {
      // Admin Users
      addServerHandler({ route: '/api/admin/users', handler: resolve('./runtime/server/api/admin/users/index.get') })
      addServerHandler({ route: '/api/admin/users', method: 'post', handler: resolve('./runtime/server/api/admin/users/index.post') })
      addServerHandler({ route: '/api/admin/users/:email', method: 'delete', handler: resolve('./runtime/server/api/admin/users/[email].delete') })
      addServerHandler({ route: '/api/admin/users/:email/credentials', handler: resolve('./runtime/server/api/admin/users/[email]/credentials.get') })

      // Admin SSH Keys
      addServerHandler({ route: '/api/admin/users/:email/ssh-keys', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys.get') })
      addServerHandler({ route: '/api/admin/users/:email/ssh-keys', method: 'post', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys.post') })
      addServerHandler({ route: '/api/admin/users/:email/ssh-keys/:keyId', method: 'delete', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete') })

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
      addServerHandler({ route: '/api/grants/batch', method: 'post', handler: resolve('./runtime/server/api/grants/batch.post') })
    }

    // Server route handlers — Delegations
    if (routeConfig.grants) {
      addServerHandler({ route: '/api/delegations', handler: resolve('./runtime/server/api/delegations/index.get') })
      addServerHandler({ route: '/api/delegations', method: 'post', handler: resolve('./runtime/server/api/delegations/index.post') })
      addServerHandler({ route: '/api/delegations/:id', method: 'delete', handler: resolve('./runtime/server/api/delegations/[id].delete') })
      addServerHandler({ route: '/api/delegations/:id/validate', method: 'post', handler: resolve('./runtime/server/api/delegations/[id]/validate.post') })

      // Server-side shape registry (Phase 1 of policy-shift). Gated with
      // `grants` because shapes drive the grant-creation pipeline (argv
      // resolution, risk scoring, display strings).
      addServerHandler({ route: '/api/shapes', handler: resolve('./runtime/server/api/shapes/index.get') })
      addServerHandler({ route: '/api/shapes/:cliId', handler: resolve('./runtime/server/api/shapes/[cliId].get') })
      addServerHandler({ route: '/api/shapes/resolve', method: 'post', handler: resolve('./runtime/server/api/shapes/resolve.post') })

      // Standing grants — user-created pre-authorizations that auto-approve
      // matching agent grant requests. Phase 1 Milestone 5.
      addServerHandler({ route: '/api/standing-grants', handler: resolve('./runtime/server/api/standing-grants/index.get') })
      addServerHandler({ route: '/api/standing-grants', method: 'post', handler: resolve('./runtime/server/api/standing-grants/index.post') })
      addServerHandler({ route: '/api/standing-grants/bulk-seed', method: 'post', handler: resolve('./runtime/server/api/standing-grants/bulk-seed.post') })
      addServerHandler({ route: '/api/standing-grants/:id', method: 'delete', handler: resolve('./runtime/server/api/standing-grants/[id].delete') })

      // Agent-view aggregate (per-agent standing grants + recent activity).
      // Phase 1 Milestone 7. Self-service only (requireAuth + caller == email).
      addServerHandler({ route: '/api/users/:email/agents', handler: resolve('./runtime/server/api/users/[email]/agents.get') })

      // YOLO auto-approval policy (per-agent)
      addServerHandler({ route: '/api/users/:email/yolo-policy', handler: resolve('./runtime/server/api/users/[email]/yolo-policy.get') })
      addServerHandler({ route: '/api/users/:email/yolo-policy', method: 'put', handler: resolve('./runtime/server/api/users/[email]/yolo-policy.put') })
      addServerHandler({ route: '/api/users/:email/yolo-policy', method: 'delete', handler: resolve('./runtime/server/api/users/[email]/yolo-policy.delete') })
    }

    // Server route handlers — Agent
    if (routeConfig.agent) {
      addServerHandler({ route: '/api/agent/challenge', method: 'post', handler: resolve('./runtime/server/api/agent/challenge.post') })
      addServerHandler({ route: '/api/agent/authenticate', method: 'post', handler: resolve('./runtime/server/api/agent/authenticate.post') })
      addServerHandler({ route: '/api/agent/enroll', method: 'post', handler: resolve('./runtime/server/api/agent/enroll.post') })

      // Unified auth endpoints (agents + humans with SSH keys)
      addServerHandler({ route: '/api/auth/challenge', method: 'post', handler: resolve('./runtime/server/api/auth/challenge.post') })
      addServerHandler({ route: '/api/auth/authenticate', method: 'post', handler: resolve('./runtime/server/api/auth/authenticate.post') })
      addServerHandler({ route: '/api/auth/enroll', method: 'post', handler: resolve('./runtime/server/api/agent/enroll.post') })
    }

    // Server route handlers — Federation
    if (routeConfig.auth) {
      addServerHandler({ route: '/auth/federated/:providerId', handler: resolve('./runtime/server/routes/auth/federated/[providerId].get') })
      addServerHandler({ route: '/auth/federated/:providerId/callback', handler: resolve('./runtime/server/routes/auth/federated/[providerId].callback.get') })
      addServerHandler({ route: '/api/federation/providers', handler: resolve('./runtime/server/api/federation/providers.get') })
    }
  },
})
