export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  runtimeConfig: {
    sessionSecret: '',
    issuer: 'https://id.openape.at',
    resendApiKey: '',
    resendFrom: 'auth@openape.at',
  },

  compatibilityDate: '2025-01-01',
})
