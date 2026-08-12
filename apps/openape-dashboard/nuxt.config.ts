// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icon-192.png', sizes: '192x192' },
        { rel: 'apple-touch-icon', href: '/icon-512.png', sizes: '512x512' },
      ],
    },
  },

  css: ['~/assets/main.css'],

  runtimeConfig: {
    // DB — overridden by NUXT_TURSO_URL. Local dev file so `pnpm dev` works
    // without env setup. Prod MUST set NUXT_TURSO_URL (path under shared/).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // NUXT_PUBLIC_URL — canonical public origin (deep-links, redirects).
    publicUrl: 'https://dashboard.openape.ai',
    public: {
      siteName: 'OpenApe Dashboard',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'dashboard.openape.ai',
    spName: 'OpenApe Dashboard',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    postLoginRedirect: '/dashboard',
    // Scope catalog — discoverable at /.well-known/openape.json.
    manifest: {
      scopes: [
        {
          id: 'kpi:push',
          description: 'Push a KPI value (owner = the delegating user).',
          grants: ['POST /api/kpis'],
        },
        {
          id: 'kpi:read',
          description: 'Read your own KPIs.',
          grants: ['GET /api/kpis'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
    // PFLICHT: ohne asyncContext fällt useEvent()/Store-Lookup in Nitro still
    // auf Defaults zurück (leere Daten). Siehe OpenApe Memory-Lesson.
    experimental: { asyncContext: true },
  },
})
