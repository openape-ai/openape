export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@openape/nuxt-auth-idp'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  colorMode: {
    preference: 'dark',
  },

  openapeIdp: {
    sessionSecret: process.env.NUXT_OPENAPE_SESSION_SECRET || '',
    managementToken: process.env.NUXT_OPENAPE_MANAGEMENT_TOKEN || '',
    adminEmails: '', // Dynamic per-tenant
    issuer: '', // Dynamic per-tenant
    rpName: '', // Dynamic per-tenant
    rpID: '', // Dynamic per-tenant
    rpOrigin: '', // Dynamic per-tenant
    grants: {
      enablePages: true,
    },
  },

  runtimeConfig: {
    platformAdminEmails: '',
    stripeSecretKey: '',
    stripeWebhookSecret: '',
    stripePriceUserMonthly: '',
    stripePriceAgentMonthly: '',
    s3AccessKey: '',
    s3SecretKey: '',
    s3Bucket: '',
    s3Endpoint: '',
    s3Region: '',
    vercelApiToken: '',
    vercelProjectId: '',
    vercelTeamId: '',
    public: {
      domain: 'cloud.openape.at',
    },
  },

  nitro: {
    storage: {
      'openape-platform': process.env.NUXT_S3_ACCESS_KEY
        ? {
            driver: '@openape/unstorage-s3-driver',
            accessKeyId: process.env.NUXT_S3_ACCESS_KEY,
            secretAccessKey: process.env.NUXT_S3_SECRET_KEY,
            bucket: process.env.NUXT_S3_BUCKET,
            endpoint: process.env.NUXT_S3_ENDPOINT,
            region: process.env.NUXT_S3_REGION,
            prefix: 'platform/',
          }
        : {
            driver: 'fsLite',
            base: './.data/platform',
          },
    },
  },
})
