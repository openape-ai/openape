export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3001 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  runtimeConfig: {
    sessionSecret: 'change-me-sp-secret-at-least-32-chars-long',
    spId: '',
    clawgateUrl: 'http://localhost:3000',
  },
  // Storage 'db' mount is handled by server/plugins/storage.ts at runtime
  // to support dynamic driver switching (fs vs s3) via STORAGE_DRIVER env var
})
