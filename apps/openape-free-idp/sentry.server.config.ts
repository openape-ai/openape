import * as Sentry from '@sentry/nuxt'

Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://c13ec4f10b20928d7ff357a5dac45dd9@o4511176896806912.ingest.de.sentry.io/4511177169371216',
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV || 'production',
})
