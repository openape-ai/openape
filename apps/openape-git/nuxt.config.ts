export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],

  app: {
    head: { link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }] },
  },

  css: ['~/assets/main.css'],

  runtimeConfig: {
    // DB — overridden at runtime by NUXT_TURSO_URL. Local dev file default so
    // `pnpm dev` works without env setup. Production MUST set NUXT_TURSO_URL
    // (path under /srv/ape-git so it lives on the data volume).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Bare repos live under `${gitDataDir}/repos/<owner>/<name>.git`.
    // Production mounts the block-storage volume here (NUXT_GIT_DATA_DIR=/srv/ape-git).
    gitDataDir: './data',
    // IdP whose EdDSA JWTs the git smart-HTTP transport accepts
    // (HTTP Basic, password field = JWT — the x-access-token pattern).
    idpUrl: 'https://id.openape.ai',
    // Transport rate limit: requests per window per client IP. Generous on
    // purpose — one clone is 2 requests, and agents fetch often (see the
    // idp-rate-limit-starves-owner lesson).
    gitRateLimit: 240,
    gitRateWindowSec: 60,
    // /api/health/backup turns red once the last off-site backup is older than
    // this. 36h: a daily backup may skip one run (host reboot) before it counts
    // as broken, but two missed days never pass unnoticed.
    backupMaxAgeSec: 36 * 3600,
    public: { siteName: 'ape-git' },
  },

  colorMode: { preference: 'dark', fallback: 'dark' },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'repos.openape.ai',
    spName: 'ape-git',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || process.env.NUXT_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    manifest: {
      scopes: [
        {
          id: 'repos:read',
          description: 'List your repositories and their access grants.',
          grants: ['GET /api/repos', 'GET /api/repos/:owner/:name'],
        },
        {
          id: 'repos:write',
          description: 'Create repositories, issue and revoke repo access grants.',
          grants: ['POST /api/repos', 'POST /api/repos/:owner/:name/grants', 'POST /api/grants/:id/revoke'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
    // Ships the pre-receive hook inside the server bundle; a boot plugin
    // installs it into `${gitDataDir}/hooks` (see plugins/03.git-hooks.ts).
    serverAssets: [{ baseName: 'hooks', dir: './hooks' }],
  },
})
