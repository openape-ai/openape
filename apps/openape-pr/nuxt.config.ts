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
    // sets NUXT_PUBLIC_URL=https://pr.openape.ai explicitly.
    publicUrl: '',
    public: {
      siteName: 'OpenApe PR',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'pr.openape.ai',
    spName: 'OpenApe PR',
    // Module default is `/dashboard`, which this app doesn't have → post-login
    // 404. Land on `/` (always exists); index.vue forwards a logged-in user to
    // /prs. Set explicitly so the redirect can never 404.
    postLoginRedirect: '/',
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
          id: 'prs:read',
          description: 'List and read pull requests and their review verdicts.',
          grants: ['GET /api/prs', 'GET /api/prs/:id', 'GET /api/prs/:slug/review'],
        },
        {
          id: 'prs:write',
          description: 'Upload pull requests for review and delete your own.',
          grants: ['POST /api/prs', 'PUT /api/prs/:id/assets/*', 'DELETE /api/prs/:id'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
  },
})
