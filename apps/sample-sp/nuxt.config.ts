export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3001 },
  compatibilityDate: '2025-01-01',
  runtimeConfig: {
    sessionSecret: 'change-me-sp-secret-at-least-32-chars-long',
    spId: '',
    spRedirectUri: '',
    clawgateUrl: 'https://id.example.org',
  },
  // Storage 'db' mount is handled by server/plugins/storage.ts at runtime
  // to support dynamic driver switching (fs vs s3) via STORAGE_DRIVER env var
})
