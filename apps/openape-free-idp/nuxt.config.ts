const e2e = process.env.OPENAPE_E2E === '1'
const localIssuer = process.env.OPENAPE_ISSUER || 'https://id.openape.at'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-idp', '@sentry/nuxt/module'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark' },

  openapeIdp: {
    sessionSecret: process.env.OPENAPE_SESSION_SECRET || '',
    managementToken: process.env.OPENAPE_MANAGEMENT_TOKEN || '',
    adminEmails: process.env.OPENAPE_ADMIN_EMAILS || '',
    storageKey: 'idp',
    issuer: localIssuer,
    rpName: process.env.OPENAPE_RP_NAME || 'OpenApe Free IdP',
    rpID: process.env.OPENAPE_RP_ID || new URL(localIssuer).hostname,
    rpOrigin: process.env.OPENAPE_RP_ORIGIN || localIssuer,
    grants: { enablePages: true, storageKey: 'grants' },
    routes: { admin: e2e },
  },

  runtimeConfig: {
    resendApiKey: '',
    resendFrom: 'auth@openape.at',
    tursoUrl: '',
    tursoAuthToken: '',
    public: {
      maxAgentsPerUser: 10,
    },
  },

  compatibilityDate: '2025-01-01',
})
