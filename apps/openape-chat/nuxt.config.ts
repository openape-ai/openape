export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  nitro: { experimental: { asyncContext: true, websocket: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
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
})
