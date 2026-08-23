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
    // DB — overridden at runtime by NUXT_TURSO_URL. Local dev file default so
    // `pnpm dev` works without env setup. Production MUST set NUXT_TURSO_URL
    // (path under shared/ so it survives deploy rotation).
    tursoUrl: 'file:./dev.db',
    tursoAuthToken: '',
    // Telegram leg of the request notification. All three empty by default:
    // without them the notifier is a silent no-op, the same shape the IdP uses
    // for pending grants. `telegramApprover` scopes the chat to one person —
    // a chat belongs to exactly one human, the service does not.
    telegramBotToken: process.env.NUXT_TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.NUXT_TELEGRAM_CHAT_ID || '',
    telegramApprover: process.env.NUXT_TELEGRAM_APPROVER || '',
    // Empty default → public URLs derive from the request origin. Production
    // sets NUXT_PUBLIC_URL=https://secrets.openape.ai explicitly.
    publicUrl: '',
    public: {
      siteName: 'OpenApe Secrets',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  openapeSp: {
    clientId: process.env.NUXT_OPENAPE_CLIENT_ID || 'secrets.openape.ai',
    spName: 'OpenApe Secrets',
    sessionSecret: process.env.NUXT_OPENAPE_SP_SESSION_SECRET
      || process.env.NUXT_SESSION_SECRET
      || 'dev-session-secret-at-least-32-characters-long',
    fallbackIdpUrl: process.env.NUXT_FALLBACK_IDP_URL || 'https://id.openape.ai',
    manifest: {
      scopes: [
        {
          id: 'secrets:request',
          description: 'Ask you to supply a secret for one of your machines. Never grants access to any value.',
          grants: ['POST /api/requests', 'GET /api/requests', 'GET /api/requests/:id'],
        },
        {
          id: 'secrets:manage',
          description: 'Register and list the machines that may receive secrets.',
          grants: ['POST /api/consumers', 'GET /api/consumers'],
        },
      ],
    },
  },

  nitro: {
    preset: 'node-server',
  },
})
