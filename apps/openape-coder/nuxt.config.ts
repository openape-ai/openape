export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // Client-only render. Coder is fully behind the passkey login with no SEO
  // surface, and every page branches on the SP session (signed-in vs the
  // sign-in landing). Resolving that auth state differs between server and
  // client, which produced "Hydration completed but contains mismatches"
  // warnings (#650). SPA mode removes the server render — and thus the
  // mismatch — entirely; the Nitro API/OAuth routes are unaffected.
  ssr: false,
  // asyncContext for useEvent() in server utils — same as org/troop.
  nitro: { experimental: { asyncContext: true } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3030 },
  compatibilityDate: '2025-01-01',
  colorMode: { preference: 'dark' },

  app: {
    head: {
      meta: [
        { name: 'theme-color', content: '#18181b' },
        { name: 'description', content: 'The cloud home for software projects — vision, repos, members and user stories in one place.' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'OpenApe Coder' },
        { property: 'og:title', content: 'OpenApe Coder — projects, stories, teams' },
        { property: 'og:url', content: 'https://coder.openape.ai' },
      ],
    },
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'coder.openape.ai',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Coder',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-coder-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.ai',
    postLoginRedirect: '/',
  },

  runtimeConfig: {
    tursoUrl: process.env.NUXT_TURSO_URL || 'file:./openape-coder.db',
    tursoAuthToken: process.env.NUXT_TURSO_AUTH_TOKEN || '',
    public: {
      idpUrl: process.env.NUXT_PUBLIC_IDP_URL || 'https://id.openape.ai',
    },
  },
})
