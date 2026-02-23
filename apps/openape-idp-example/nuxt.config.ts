export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@openape/nuxt-auth-idp', '@openape/nuxt-grants'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3000 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  openapeIdp: {
    storageDriver: process.env.STORAGE_DRIVER || '',
    adminEmails: process.env.OPENAPE_ADMIN_EMAILS || '',
    managementToken: process.env.OPENAPE_MANAGEMENT_TOKEN || '',
  },
  openapeGrants: {
    enablePages: true,
  },
})
