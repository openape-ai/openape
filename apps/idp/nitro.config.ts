export default defineNitroConfig({
  compatibilityDate: '2025-01-01',
  srcDir: 'server',
  preset: process.env.NITRO_PRESET || 'node-server',
  serveStatic: true,
  runtimeConfig: {
    issuer: process.env.OPENAPE_ISSUER || 'http://localhost:3000',
    managementToken: process.env.OPENAPE_MANAGEMENT_TOKEN || '',
    sessionSecret: process.env.OPENAPE_SESSION_SECRET || 'change-me-to-a-secret-at-least-32-characters!',
    adminEmails: process.env.OPENAPE_ADMIN_EMAILS || '',
    tursoUrl: process.env.TURSO_DATABASE_URL || 'file:local.db',
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
  },
  routeRules: {
    '/api/auth/**': { cors: true },
    '/api/agent/**': { cors: true },
    '/api/grants/**': { cors: true },
    '/api/delegations/**': { cors: true },
    '/.well-known/**': { cors: true },
    '/token': { cors: true },
    '/userinfo': { cors: true },
    '/revoke': { cors: true },
  },
})
