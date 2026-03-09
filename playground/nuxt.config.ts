export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  colorMode: {
    preference: 'dark',
  },
  openapeIdp: {
    sessionSecret: 'playground-secret-at-least-32-characters-long',
    managementToken: 'playground-token',
    adminEmails: 'admin@playground.local',
    rpName: 'Playground IdP',
    rpID: 'localhost',
    rpOrigin: 'http://localhost:3000',
    grants: { enablePages: true },
  },
  nitro: {
    storage: {
      'openape-idp': { driver: 'fsLite', base: './.data/openape-idp' },
      'openape-grants': { driver: 'fsLite', base: './.data/openape-grants' },
    },
  },
})
