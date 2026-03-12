export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3001 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'sp.example.com',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Service Provider',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-sp-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.at',
  },
})
