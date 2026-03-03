export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  imports: { autoImport: false },

  runtimeConfig: {
    sessionSecret: '',
    issuer: 'https://id.openape.at',
    resendApiKey: '',
    resendFrom: 'auth@openape.at',
  },

  nitro: {
    imports: { autoImport: false },
  },

  compatibilityDate: '2025-01-01',
})
