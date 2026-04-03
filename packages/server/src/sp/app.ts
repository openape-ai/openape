import { WELL_KNOWN_OAUTH_CLIENT_METADATA } from '@openape/core'
import { createApp, createRouter } from 'h3'
import type { SPConfig, SPInstance } from './config.js'
import { createApiCallbackHandler } from './handlers/api-callback.js'
import { createApiGrantCallbackHandler } from './handlers/api-grant-callback.js'
import { createApiGrantStatusHandler } from './handlers/api-grant-status.js'
import { createApiLoginHandler } from './handlers/api-login.js'
import { createApiMeHandler } from './handlers/api-me.js'
import { createApiProtectedActionHandler } from './handlers/api-protected-action.js'
import { createApiRequestPermissionHandler } from './handlers/api-request-permission.js'
import { createCallbackHandler } from './handlers/callback.js'
import { createLoginHandler } from './handlers/login.js'
import { createMeHandler } from './handlers/me.js'
import { createMetadataHandler } from './handlers/metadata.js'

export function createSPApp(config: SPConfig): SPInstance {
  const app = createApp()
  const router = createRouter()

  // Original headless routes (JSON-based sessions)
  router.get('/login', createLoginHandler(config))
  router.get('/callback', createCallbackHandler(config))
  router.get('/me', createMeHandler())
  router.get(WELL_KNOWN_OAUTH_CLIENT_METADATA, createMetadataHandler(config))

  // Nuxt-compatible API routes (cookie-based sessions, redirect-based callback)
  router.post('/api/login', createApiLoginHandler(config))
  router.get('/api/callback', createApiCallbackHandler(config))
  router.get('/api/me', createApiMeHandler())

  // Grant-related SP routes (used by grant-rerequest E2E test)
  router.post('/api/request-permission', createApiRequestPermissionHandler(config))
  router.get('/api/grant-callback', createApiGrantCallbackHandler())
  router.post('/api/protected-action', createApiProtectedActionHandler(config))
  router.get('/api/grant-status', createApiGrantStatusHandler())

  app.use(router)
  return { app }
}
