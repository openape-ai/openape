// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@openape/nuxt-auth-sp'],

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  css: ['~/assets/main.css'],

  runtimeConfig: {
    // DB — overridden at runtime by NUXT_TURSO_URL. Defaults to a local dev
    // file so `pnpm dev` works without any env setup. Production MUST set
    // NUXT_TURSO_URL (path under shared/ so it survives deploy rotation).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Empty default → public URLs derive from the request origin. Production
    // sets NUXT_PUBLIC_URL=https://testrun.openape.ai explicitly.
    publicUrl: '',
    briefingUrl: '',
    documentPublishingEnabled: false,
    htmlPublishingEnabled: false,
    htmlWritesFrozen: false,
    plansConsolidated: false,
    plansWritesFrozen: false,
    plansBridgeSecret: '',
    plansInviteSecret: '',
    htmlContentOrigin: '',
    htmlPolicyJournalPath: '',
    public: {
      siteName: 'OpenApe Reports',
      htmlContentOrigin: '',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'testrun.openape.ai',
    spName: 'OpenApe Reports',
    additionalRedirectUris: ['https://report.openape.ai/api/callback', 'https://report.openape.ai/oauth/grants/callback'],
    catalogOnlyScopes: ['reports:read', 'reports:publish', 'reports:manage'],
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || process.env.NUXT_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    // Scope catalog — discoverable at /.well-known/openape.json. A Receiver
    // requests a subset of these; the exchange handler validates delegation
    // tokens against the entry ids.
    manifest: {
      scopes: [
        { id: 'reports:read', description: 'Read your report collection and private documents.', grants: ['GET /api/plans-compat/teams', 'GET /api/plans-compat/teams/:id', 'GET /api/plans-compat/teams/:id/plans', 'GET /api/plans-compat/teams/:id/invites', 'GET /api/plans-compat/plans/:id', 'GET /api/documents', 'GET /api/documents/:id', 'GET /api/documents/:id/:action', 'POST /api/documents/:id/viewer', 'GET /api/reports', 'GET /api/report-series', 'GET /api/public/runs/:slug', 'GET /api/public/runs/:slug/document', 'GET /api/public/runs/:slug/assets/*'] },
        { id: 'reports:publish', description: 'Publish reports and reconcile exact receipts.', grants: ['POST /api/documents', 'PATCH /api/documents/:id', 'POST /api/reports', 'POST /api/reports/preview', 'GET /api/reports/publication', 'GET /api/report-series/:id/editions/:date/publication'] },
        { id: 'reports:manage', description: 'Create your series and manage its publisher.', grants: ['POST /api/plans-compat/teams', 'POST /api/plans-compat/teams/:id/plans', 'POST /api/plans-compat/teams/:id/invites', 'POST /api/plans-compat/teams/:id/archive', 'POST /api/plans-compat/teams/:id/unarchive', 'POST /api/plans-compat/invites/accept', 'PATCH /api/plans-compat/plans/:id', 'PATCH /api/plans-compat/teams/:id', 'DELETE /api/plans-compat/plans/:id', 'DELETE /api/plans-compat/teams/:id', 'DELETE /api/plans-compat/teams/:id/members/:email', 'DELETE /api/plans-compat/invites/:id', 'POST /api/documents/:id/access', 'POST /api/documents/:id/retention', 'POST /api/documents/:id/restore', 'DELETE /api/documents/:id', 'POST /api/report-series', 'PUT /api/report-series/:id/publisher'] },
        {
          id: 'testruns:read',
          description: 'List and read your uploaded test runs.',
          grants: ['GET /api/runs', 'GET /api/runs/:id'],
        },
        {
          id: 'testruns:write',
          description: 'Upload new test runs and delete your own.',
          grants: ['POST /api/runs', 'PUT /api/runs/:id/assets/*', 'DELETE /api/runs/:id'],
        },
      ],
    },
  },

  nitro: {
    externals: { inline: ['@openape/report-contracts'] },
    preset: 'node-server',
  },
})
