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
    // `pnpm dev` works without env setup. Production MUST set NUXT_TURSO_URL
    // (path under shared/ so it survives deploy rotation).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Empty default → public URLs derive from the request origin. Production
    // sets NUXT_PUBLIC_URL=https://monitor.openape.ai explicitly.
    publicUrl: '',
    // Outbound down/up alert mail via Resend (same setup as id.openape.ai).
    // Empty key → alerts are skipped (logged), the monitor still runs.
    resendApiKey: '',
    mailFrom: 'monitor@openape.ai',
    public: {
      siteName: 'OpenApe Monitor',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'monitor.openape.ai',
    spName: 'OpenApe Monitor',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || process.env.NUXT_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    manifest: {
      scopes: [
        {
          id: 'monitors:read',
          description: 'List and read your uptime monitors and their status.',
          grants: ['GET /api/monitors'],
        },
        {
          id: 'monitors:write',
          description: 'Add, re-check and delete your own uptime monitors.',
          grants: ['POST /api/monitors', 'POST /api/monitors/:id/check', 'DELETE /api/monitors/:id'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
  },
})
