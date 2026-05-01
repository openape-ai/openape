export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  nitro: { experimental: { asyncContext: true, websocket: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3007 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'chat.openape.ai',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Chat',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-chat-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.ai',
  },

  runtimeConfig: {
    tursoUrl: process.env.NUXT_TURSO_URL || 'file:./openape-chat.db',
    tursoAuthToken: process.env.NUXT_TURSO_AUTH_TOKEN || '',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
    },
  },

  // PWA: installable, offline-tolerant for the shell, never serves stale
  // HTML or stale API. Hashed assets under /_nuxt/** are CacheFirst (safe
  // because the filename changes on every build). HTML and /api/** are
  // NetworkFirst — the browser tries the network first and only falls
  // back to cache when offline. This is the single most important guard
  // against "users stuck on a 6-week-old build" SW horror stories.
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'OpenApe Chat',
      short_name: 'OpenApe Chat',
      description: 'Team rooms and DMs for humans and agents.',
      theme_color: '#18181b',
      background_color: '#18181b',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      // Single SVG icon for now — Patrick can swap in proper PNG raster icons
      // (192/512 incl. maskable) before the production deploy. SVG works in
      // Chrome/Safari/Firefox PWA installs as of 2024+.
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      navigateFallback: null, // never serve a cached HTML shell — we want NetworkFirst
      runtimeCaching: [
        {
          urlPattern: /\/api\/.*/i,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-cache',
            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            networkTimeoutSeconds: 5,
          },
        },
        {
          urlPattern: /\/_nuxt\/.*/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'nuxt-assets',
            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          urlPattern: ({ request }) => request.destination === 'document',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'html-cache',
            networkTimeoutSeconds: 3,
          },
        },
      ],
    },
    client: {
      installPrompt: true,
      // Force the SW to take control on first visit so users see a fresh
      // build immediately on next reload, not after the second.
      periodicSyncForUpdates: 60 * 60, // check hourly while tab is open
    },
    devOptions: {
      // Don't run the SW in `pnpm dev` — it makes HMR unreliable and isn't
      // representative of production behaviour.
      enabled: false,
    },
  },
})
