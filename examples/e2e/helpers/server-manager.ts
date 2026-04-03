import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { toNodeListener } from 'h3'
import { createIdPApp, createSPApp } from '@openape/server'
import { IDP_PORT, IDP_URL, IS_PROD, MANAGEMENT_TOKEN, SP_ID, SP_PORT, SP_URL } from './constants.js'

let idpServer: Server | null = null
let spServer: Server | null = null

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

  idpServer = createServer(toNodeListener(idpApp))
  spServer = createServer(toNodeListener(spApp))

  await Promise.all([
    new Promise<void>(resolve => idpServer!.listen(IDP_PORT, resolve)),
    new Promise<void>(resolve => spServer!.listen(SP_PORT, resolve)),
  ])
}

export async function stopServers(): Promise<void> {
  if (IS_PROD) return
  await Promise.all([
    idpServer ? new Promise<void>(resolve => idpServer!.close(() => resolve())) : Promise.resolve(),
    spServer ? new Promise<void>(resolve => spServer!.close(() => resolve())) : Promise.resolve(),
  ])
  idpServer = null
  spServer = null
}
