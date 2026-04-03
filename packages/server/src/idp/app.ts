import { createApp, createRouter } from 'h3'
import type { IdPConfig, IdPInstance, IdPStores } from './config.js'

export function createIdPApp(_config: IdPConfig, stores: IdPStores): IdPInstance {
  const app = createApp()
  const router = createRouter()

  // TODO: Register handlers (Milestone 3)

  app.use(router)
  return { app, stores }
}
