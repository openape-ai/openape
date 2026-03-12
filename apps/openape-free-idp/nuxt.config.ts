export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-idp'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  openapeIdp: {
    sessionSecret: '',
    managementToken: '',
    adminEmails: '',
    storageKey: 'idp',
    issuer: 'https://id.openape.at',
    rpName: 'OpenApe Free IdP',
    rpID: 'id.openape.at',
    rpOrigin: 'https://id.openape.at',
    grants: { enablePages: true, storageKey: 'grants' },
    routes: { admin: false },
  },

  runtimeConfig: {
    resendApiKey: '',
    resendFrom: 'auth@openape.at',
    tursoUrl: '',
    tursoAuthToken: '',
  },

  compatibilityDate: '2025-01-01',
})
