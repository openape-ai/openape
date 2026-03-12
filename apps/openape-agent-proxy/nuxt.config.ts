export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'localhost:3004',
    spName: 'OpenApe Proxy',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || '',
    openapeUrl: process.env.NUXT_OPENAPE_URL || '',
  },

  compatibilityDate: '2025-01-01',
})
