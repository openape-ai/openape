export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // asyncContext is required for `useEvent()` to resolve in Vercel
  // Serverless and is good practice on traditional servers too — see
  // openape-monorepo MEMORY.md for the gotcha.
  // websocket: true enables the crossws WS server, required for the
  // /api/nest-ws control-plane endpoint that lets local nest daemons
  // push instant config-updates + receive spawn-intents (see
  // .claude/plans/nest-troop-ws.md). asyncContext stays on for
  // useEvent()-based session lookups in PATCH handlers that hook
  // the broadcast on the way out.
  nitro: { experimental: { asyncContext: true, websocket: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3010 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  app: {
    head: {
      // titleTemplate function lives in app/plugins/head.ts — a function
      // here gets serialized at build time and silently dropped, leaving
      // every page rendering its own title without the suffix.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-192.png', sizes: '192x192' },
        { rel: 'apple-touch-icon', href: '/icon-512.png', sizes: '512x512' },
      ],
      meta: [
        { name: 'theme-color', content: '#18181b' },
        { name: 'description', content: 'Manage your OpenApe agents — crons, system prompts, tools, run history.' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'OpenApe Troop' },
        // Open Graph — controls Slack/Discord/iMessage/Twitter previews
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'OpenApe Troop' },
        { property: 'og:title', content: 'OpenApe Troop — we feed baby apes with inference' },
        { property: 'og:description', content: 'Cron-scheduled, single-purpose agents on your own machine. Manage from anywhere.' },
        { property: 'og:url', content: 'https://troop.openape.ai' },
        { property: 'og:image', content: 'https://troop.openape.ai/og-image.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'OpenApe Troop — we feed baby apes with inference' },
        { name: 'twitter:description', content: 'Cron-scheduled, single-purpose agents on your own machine.' },
        { name: 'twitter:image', content: 'https://troop.openape.ai/og-image.png' },
      ],
    },
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'troop.openape.ai',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Troop',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-troop-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.ai',
    // troop's root page is the agent list — there's no /dashboard.
    // Without this the SP module's default would 404 after every
    // successful OIDC callback.
    postLoginRedirect: '/',
  },

  runtimeConfig: {
    tursoUrl: process.env.NUXT_TURSO_URL || 'file:./openape-troop.db',
    tursoAuthToken: process.env.NUXT_TURSO_AUTH_TOKEN || '',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
    },
  },
})
