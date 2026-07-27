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
    // Only used from Milestone 2 on (the sp-tasks queue lives here).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Bound service-agent(s) allowed to pull/resolve tasks — comma list of
    // DDISA emails. Runtime-overridden by NUXT_AGENT_SERVICE_EMAIL.
    agentServiceEmail: '',
    // NUXT_PUBLIC_URL — canonical public origin (deep-links, redirects).
    publicUrl: 'https://question-service.openape.ai',
    public: {
      siteName: 'OpenApe Question Service',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'question-service.openape.ai',
    spName: 'OpenApe Question Service',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    // Real landing page (the Q&A UI) — module default is `/` since #1021.
    postLoginRedirect: '/dashboard',
    // Scope catalog — discoverable at /.well-known/openape.json.
    manifest: {
      scopes: [
        {
          id: 'question:ask',
          description: 'Ask a question and read the generated answer.',
          grants: ['POST /api/question', 'GET /api/answer/:taskId'],
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
