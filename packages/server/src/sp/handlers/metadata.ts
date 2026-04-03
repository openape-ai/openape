import type { EventHandler } from 'h3'
import { createClientMetadata } from '@openape/auth'
import { defineEventHandler } from 'h3'
import type { SPConfig } from '../config.js'

export function createMetadataHandler(config: SPConfig): EventHandler {
  return defineEventHandler(() => {
    return createClientMetadata({
      client_id: config.clientId,
      client_name: config.spName ?? config.clientId,
      redirect_uris: [config.redirectUri],
    })
  })
}
