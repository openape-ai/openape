export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@openape/nuxt-auth-idp'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  devServer: { port: 3000 },
  compatibilityDate: '2025-01-01',
  colorMode: {
    preference: 'dark',
  },
  openapeIdp: {
    adminEmails: process.env.NUXT_OPENAPE_ADMIN_EMAILS || '',
    managementToken: process.env.NUXT_OPENAPE_MANAGEMENT_TOKEN || '',
    sessionSecret: process.env.NUXT_OPENAPE_SESSION_SECRET || 'change-me-to-a-real-secret-at-least-32-chars',
    issuer: process.env.NUXT_OPENAPE_ISSUER || '',
    rpName: process.env.NUXT_OPENAPE_RP_NAME || 'OpenApe Identity',
    rpID: process.env.NUXT_OPENAPE_RP_ID || 'localhost',
    rpOrigin: process.env.NUXT_OPENAPE_RP_ORIGIN || 'http://localhost:3000',
    requireUserVerification: process.env.NUXT_OPENAPE_REQUIRE_USER_VERIFICATION === 'true',
    residentKey: (process.env.NUXT_OPENAPE_RESIDENT_KEY as 'preferred' | 'required' | 'discouraged') || 'preferred',
    attestationType: (process.env.NUXT_OPENAPE_ATTESTATION_TYPE as 'none' | 'indirect' | 'direct' | 'enterprise') || 'none',
  },
  nitro: {
    storage: {
      'openape-idp': process.env.NUXT_OPENAPE_S3_ACCESS_KEY
        ? {
            driver: '@openape/unstorage-s3-driver',
            accessKeyId: process.env.NUXT_OPENAPE_S3_ACCESS_KEY,
            secretAccessKey: process.env.NUXT_OPENAPE_S3_SECRET_KEY,
            bucket: process.env.NUXT_OPENAPE_S3_BUCKET,
            endpoint: process.env.NUXT_OPENAPE_S3_ENDPOINT,
            region: process.env.NUXT_OPENAPE_S3_REGION,
            prefix: process.env.NUXT_OPENAPE_S3_PREFIX || 'openape-idp/',
          }
        : {
            driver: 'fsLite',
            base: './.data/openape-idp',
          },
      'openape-grants': process.env.NUXT_OPENAPE_S3_ACCESS_KEY
        ? {
            driver: '@openape/unstorage-s3-driver',
            accessKeyId: process.env.NUXT_OPENAPE_S3_ACCESS_KEY,
            secretAccessKey: process.env.NUXT_OPENAPE_S3_SECRET_KEY,
            bucket: process.env.NUXT_OPENAPE_S3_BUCKET,
            endpoint: process.env.NUXT_OPENAPE_S3_ENDPOINT,
            region: process.env.NUXT_OPENAPE_S3_REGION,
            prefix: process.env.NUXT_OPENAPE_S3_GRANTS_PREFIX || 'openape-grants/',
          }
        : {
            driver: 'fsLite',
            base: './.data/openape-grants',
          },
    },
  },
})
