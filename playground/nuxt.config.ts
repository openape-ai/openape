export default defineNuxtConfig({
  modules: ['../src/module'],
  compatibilityDate: '2025-01-01',
  openapeIdp: {
    sessionSecret: 'playground-secret-at-least-32-characters-long',
    rpName: 'Playground',
    rpID: 'localhost',
    rpOrigin: 'http://localhost:3000',
  },
})
