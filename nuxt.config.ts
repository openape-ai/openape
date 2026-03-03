export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  openapeSp: {
    spId: process.env.NUXT_OPENAPE_SP_ID || 'localhost:3003',
    spName: 'OpenApe Agent Mail',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || '',
    openapeUrl: process.env.NUXT_OPENAPE_URL || '',
  },

  runtimeConfig: {
    resendApiKey: '',
    webhookSecret: '',
  },

  nitro: {},

  compatibilityDate: '2025-01-01',
})
