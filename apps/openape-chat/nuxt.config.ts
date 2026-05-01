export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  nitro: { experimental: { asyncContext: true, websocket: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3007 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  // Browser tab title + favicon. The favicon mirrors id.openape.ai's
  // pattern (single emoji in a 100×100 SVG) — clean at every zoom level
  // and indistinguishable from a hand-drawn raster on retina displays.
  // Per-page <Title>…</Title> overrides this via useHead/Head; everything
  // else inherits the titleTemplate so e.g. /rooms/<name> reads
  // "alpha — OpenApe Chat".
  app: {
    head: {
      // titleTemplate lives in app/plugins/head.ts as a function — a
      // function placed here is serialized at build time and silently
      // dropped, leaving pages without their " — OpenApe Chat" suffix.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-192.png', sizes: '192x192' },
        { rel: 'apple-touch-icon', href: '/icon-512.png', sizes: '512x512' },
      ],
      meta: [
        { name: 'theme-color', content: '#18181b' },
        { name: 'description', content: 'Team rooms and DMs for humans and agents.' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'OpenApe Chat' },
      ],
    },
  },

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
    // VAPID keypair for Web Push. Generate once with `npx web-push
    // generate-vapid-keys` and persist to env. The public key is fine to
    // ship to clients (they include it when subscribing); the private key
    // and subject (a mailto: that push services can use to contact us if
    // we misbehave) are server-side only.
    vapidPrivateKey: process.env.NUXT_VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.NUXT_VAPID_SUBJECT || 'mailto:patrick@hofmann.eco',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
      vapidPublicKey: process.env.NUXT_PUBLIC_VAPID_PUBLIC_KEY || '',
    },
  },

  // PWA: installable, offline-tolerant for the shell, never serves stale
  // HTML or stale API. Hashed assets under /_nuxt/** are CacheFirst (safe
  // because the filename changes on every build). HTML and /api/** are
  // NetworkFirst — the browser tries the network first and only falls
  // back to cache when offline. This is the single most important guard
  // against "users stuck on a 6-week-old build" SW horror stories.
  pwa: {
    // injectManifest lets us own the SW source so we can handle `push` and
    // `notificationclick` events ourselves. Workbox helpers are still
    // available — we use precacheAndRoute + registerRoute for caching, and
    // hand-write the push event listeners.
    strategies: 'injectManifest',
    // SW source lives at the Nuxt project root (apps/openape-chat/sw.ts),
    // not under app/ or public/. vite-pwa joins srcDir with Nuxt's own
    // srcDir (default 'app/') so we go up one level to escape the
    // app-source treesitter and avoid Rollup misreading the entry as
    // app/public/sw.ts during the build.
    srcDir: '..',
    filename: 'sw.ts',
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
      // Raster PNGs first so older Android launchers and legacy Chromebook
      // installs render the home-screen icon at full quality. Modern browsers
      // (Chrome/Firefox/Safari) prefer the SVG. Regenerate with
      // scripts/generate-chat-icons.sh if the source SVG changes.
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 60 * 60, // check hourly while tab is open
    },
    devOptions: {
      // Don't run the SW in `pnpm dev` — HMR + SW caching is a debugging
      // nightmare and not representative of prod behaviour anyway.
      enabled: false,
    },
  },
})
