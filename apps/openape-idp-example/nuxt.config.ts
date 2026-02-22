export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3000 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  runtimeConfig: {
    sessionSecret: 'change-me-to-a-real-secret-at-least-32-chars',
    superAdminPassword: '',
    clawgateAdminEmails: '',
  },
  // Storage 'db' mount is handled by server/plugins/storage.ts at runtime
  // to support dynamic driver switching (fs vs s3) via STORAGE_DRIVER env var
  routeRules: {
    '/api/grants/**': { cors: true },
    '/api/agent/**': { cors: true },
    '/.well-known/**': { cors: true },
    '/token': { cors: true },
  },
})
