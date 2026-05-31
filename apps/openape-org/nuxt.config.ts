export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // asyncContext required for useEvent() under Vercel/Nitro serverless;
  // websocket reserved for future live-update of Org-Chart status badges
  // (Phase B) — harmless if unused at v1.
  nitro: { experimental: { asyncContext: true, websocket: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3020 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  // Same DE/EN pattern as troop. Locale files lazy-loaded, cookie
  // persistence under a namespaced key.
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'de', name: 'Deutsch', file: 'de.json' },
    ],
    lazy: true,
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'org-locale',
      fallbackLocale: 'en',
      redirectOn: 'root',
      alwaysRedirect: false,
    },
    bundle: { optimizeTranslationDirective: false },
    compilation: { strictMessage: false, escapeHtml: false },
  },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-192.png', sizes: '192x192' },
        { rel: 'apple-touch-icon', href: '/icon-512.png', sizes: '512x512' },
      ],
      meta: [
        { name: 'theme-color', content: '#18181b' },
        { name: 'description', content: 'Run your agent organization — vision, team, cost, reports. Mobile-first.' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'OpenApe Org' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'OpenApe Org' },
        { property: 'og:title', content: 'OpenApe Org — your virtual company, run by agents' },
        { property: 'og:description', content: 'A CEO, a team, a budget — and weekly reports. Mobile-first.' },
        { property: 'og:url', content: 'https://org.openape.ai' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'OpenApe Org' },
        { name: 'twitter:description', content: 'Your virtual company, run by agents.' },
      ],
    },
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'org.openape.ai',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Org',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-org-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.ai',
    // Root page is the org list, no separate dashboard route.
    postLoginRedirect: '/',
  },

  runtimeConfig: {
    tursoUrl: process.env.NUXT_TURSO_URL || 'file:./openape-org.db',
    tursoAuthToken: process.env.NUXT_TURSO_AUTH_TOKEN || '',
    // troop's API base — server-side calls from org's spawn-proxy
    // endpoint use this; UI uses the public mirror below.
    troopApiBase: process.env.NUXT_TROOP_API_BASE || 'https://troop.openape.ai',
    // org's own IdP-issued agent access token, minted once via
    // scripts/enroll-org-as-agent.sh. Required for cross-SP
    // token-exchange when spawning agents on the Owner's behalf.
    // Empty in dev → spawn endpoints return a 503 with a clear
    // bootstrap message.
    orgIdpAccessToken: process.env.NUXT_ORG_IDP_ACCESS_TOKEN || '',
    // The agent email org enrolled as — used for /api/delegations'
    // `delegate` field shown to the Owner in the bootstrap UI.
    orgIdpAgentEmail: process.env.NUXT_ORG_IDP_AGENT_EMAIL || 'agent+openape-org@id.openape.ai',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
      troopUiBase: process.env.NUXT_PUBLIC_TROOP_UI_BASE || 'https://troop.openape.ai',
      // Expose the agent email + the audience publicly so the UI can
      // build the exact CLI command for the Owner to run when
      // bootstrapping their delegation grant.
      orgIdpAgentEmail: process.env.NUXT_ORG_IDP_AGENT_EMAIL || 'agent+openape-org@id.openape.ai',
      troopAudience: process.env.NUXT_TROOP_AUDIENCE || 'apes-cli',
    },
  },
})
