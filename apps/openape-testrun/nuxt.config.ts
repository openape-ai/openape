// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  css: ['~/assets/main.css'],

  runtimeConfig: {
    // DB — overridden at runtime by NUXT_TURSO_URL. Defaults to a local dev
    // file so `pnpm dev` works without any env setup. Production MUST set
    // NUXT_TURSO_URL (path under shared/ so it survives deploy rotation).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Empty default → public URLs derive from the request origin. Production
    // sets NUXT_PUBLIC_URL=https://testrun.openape.ai explicitly.
    publicUrl: '',
    public: {
      siteName: 'OpenApe Testrun',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'testrun.openape.ai',
    spName: 'OpenApe Testrun',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || process.env.NUXT_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    // Scope catalog — discoverable at /.well-known/openape.json. A Receiver
    // requests a subset of these; the exchange handler validates delegation
    // tokens against the entry ids.
    manifest: {
      scopes: [
        {
          id: 'testruns:read',
          description: 'List and read your uploaded test runs.',
          grants: ['GET /api/runs', 'GET /api/runs/:id'],
        },
        {
          id: 'testruns:write',
          description: 'Upload new test runs and delete your own.',
          grants: ['POST /api/runs', 'PUT /api/runs/:id/assets/*', 'DELETE /api/runs/:id'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
  },
})
