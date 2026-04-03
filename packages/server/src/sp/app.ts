import { createApp, createRouter } from 'h3'
import type { SPConfig, SPInstance } from './config.js'

export function createSPApp(_config: SPConfig): SPInstance {
  const app = createApp()
  const router = createRouter()

  // TODO: Register handlers (Milestone 4)

  app.use(router)
  return { app }
}
