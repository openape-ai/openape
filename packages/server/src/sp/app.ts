import { WELL_KNOWN_OAUTH_CLIENT_METADATA } from '@openape/core'
import { createApp, createRouter } from 'h3'
import type { SPConfig, SPInstance } from './config.js'
import { createCallbackHandler } from './handlers/callback.js'
import { createLoginHandler } from './handlers/login.js'
import { createMeHandler } from './handlers/me.js'
import { createMetadataHandler } from './handlers/metadata.js'

export function createSPApp(config: SPConfig): SPInstance {
  const app = createApp()
  const router = createRouter()

  router.get('/login', createLoginHandler(config))
  router.get('/callback', createCallbackHandler(config))
  router.get('/me', createMeHandler())
  router.get(WELL_KNOWN_OAUTH_CLIENT_METADATA, createMetadataHandler(config))

  app.use(router)
  return { app }
}
