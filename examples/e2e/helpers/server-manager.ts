import type { RunningAppServer } from './lifecycle.js'
import { createIdPApp, createSPApp } from '@openape/server'
import { toNodeListener } from 'h3'
import { IDP_PORT, IDP_URL, IS_PROD, MANAGEMENT_TOKEN, SP_ID, SP_PORT, SP_URL } from './constants.js'
import { startAppServer } from './lifecycle.js'

let idpServer: RunningAppServer | null = null
let spServer: RunningAppServer | null = null

const DDISA_MOCK_RECORDS = {
  'example.com': { version: 'ddisa1' as const, idp: IDP_URL, mode: 'open' as const },
}

export async function startServers(): Promise<void> {
  if (IS_PROD) return

  const { app: idpApp } = createIdPApp({
    issuer: IDP_URL,
    managementToken: MANAGEMENT_TOKEN,
    adminEmails: ['admin@example.com'],
  })

  const { app: spApp } = createSPApp({
    clientId: SP_ID,
    redirectUri: `${SP_URL}/api/callback`,
    idpUrl: IDP_URL,
    resolverOptions: { mockRecords: DDISA_MOCK_RECORDS },
  })

  ;[idpServer, spServer] = await Promise.all([
    startAppServer(toNodeListener(idpApp), { port: IDP_PORT }),
    startAppServer(toNodeListener(spApp), { port: SP_PORT }),
  ])
}

export async function stopServers(): Promise<void> {
  if (IS_PROD) return
  await Promise.all([
    idpServer?.stop() ?? Promise.resolve(),
    spServer?.stop() ?? Promise.resolve(),
  ])
  idpServer = null
  spServer = null
}
