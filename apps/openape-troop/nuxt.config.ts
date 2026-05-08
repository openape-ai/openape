export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // asyncContext is required for `useEvent()` to resolve in Vercel
  // Serverless and is good practice on traditional servers too — see
  // openape-monorepo MEMORY.md for the gotcha.
  nitro: { experimental: { asyncContext: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3010 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
      meta: [
        { name: 'theme-color', content: '#18181b' },
        { name: 'description', content: 'Manage your OpenApe agents — crons, system prompts, tools, run history.' },
      ],
    },
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'troop.openape.ai',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Troop',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-troop-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.ai',
  },

  runtimeConfig: {
    tursoUrl: process.env.NUXT_TURSO_URL || 'file:./openape-troop.db',
    tursoAuthToken: process.env.NUXT_TURSO_AUTH_TOKEN || '',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
    },
  },
})
