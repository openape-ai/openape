export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3001 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  openapeSp: {
    spId: 'sp.example.com',
    openapeUrl: 'http://localhost:3000',
  },
})
