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
    // DB — overridden at runtime by NUXT_TURSO_URL. Local dev file default so
    // `pnpm dev` works without env setup. Production sets a file under
    // shared/ so the data survives the deploy rotation.
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    publicUrl: 'https://crm.openape.ai',
    graphClientId: '',
    graphClientSecret: '',
    graphTokenSecret: '',
    graphWebhookUrl: '',
    public: {
      siteName: 'OpenApe CRM',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'crm.openape.ai',
    spName: 'OpenApe CRM',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    manifest: {
      scopes: [
        {
          id: 'crm:read',
          description: 'Read your deals, contacts, organizations and notes.',
          grants: ['GET /api/deals', 'GET /api/contacts', 'GET /api/organizations', 'GET /api/workspaces', 'GET /api/products', 'GET /api/contracts', 'GET /api/tasks', 'GET /api/threads', 'GET /api/search'],
        },
        {
          id: 'crm:write',
          description: 'Create and change deals, contacts, organizations and notes.',
          grants: ['POST /api/deals', 'PATCH /api/deals/:id', 'POST /api/deals/reorder', 'POST /api/contacts', 'POST /api/organizations', 'POST /api/products', 'POST /api/contracts', 'POST /api/tasks', 'POST /api/threads'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
    // PFLICHT: ohne asyncContext fällt der Store-Lookup in Nitro still auf
    // Defaults zurück (leere Daten). Siehe OpenApe Memory-Lesson.
    experimental: { asyncContext: true },
  },
})
