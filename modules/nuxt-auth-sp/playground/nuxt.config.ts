export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  devServer: { port: 3001 },
  colorMode: {
    preference: 'dark',
  },
  openapeSp: {
    clientId: 'localhost:3001',
    spName: 'Playground SP',
    sessionSecret: 'playground-secret-at-least-32-characters-long',
    openapeUrl: 'http://localhost:3000',
  },
})
