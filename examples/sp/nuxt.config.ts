export default defineNuxtConfig({
  // E2E boots two nuxt dev servers at once; both would grab the same
  // vite HMR port (24678) and the loser never becomes ready.
  // Vite's HMR websocket port is fixed at 24678; the E2E harness boots
  // several dev servers at once, so each gets its own port derived from
  // its app port (run 3255: the loser died on 'Port 24678 already in use').
  vite: { server: { hmr: process.env.E2E_HMR_PORT ? { port: Number(process.env.E2E_HMR_PORT) } : undefined } },
  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3001 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  openapeSp: {
    // Empty → the SP host-derives its client_id from the request host
    // (works for dynamic preview hosts). Pin via NUXT_OPENAPE_CLIENT_ID.
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || '',
    spName: process.env.NUXT_OPENAPE_SP_NAME || 'OpenApe Service Provider',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET || 'change-me-sp-secret-at-least-32-chars-long',
    openapeUrl: process.env.NUXT_OPENAPE_URL ?? '',
    // This SP has a dashboard, so land there after login — same page the
    // grant callback returns to. Without it the module's default sends the
    // user back to `/`, which every SP is guaranteed to have.
    postLoginRedirect: '/dashboard',
    fallbackIdpUrl: process.env.NUXT_OPENAPE_SP_FALLBACK_IDP_URL || 'https://id.openape.at',
  },
})
