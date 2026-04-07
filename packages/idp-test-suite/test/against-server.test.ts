import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { toNodeListener } from 'h3'
import { afterAll, beforeAll } from 'vitest'
import { createIdPApp } from '@openape/server'
import { runIdPTestSuite } from '../src/index.js'

let server: Server
let port: number
const MGMT = 'test-mgmt-token'

beforeAll(async () => {
  const { app } = createIdPApp({
    issuer: 'http://localhost:0',
    managementToken: MGMT,
    sessionSecret: 'test-session-secret-at-least-32-characters!',
    adminEmails: ['admin@example.com'],
  })
  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => {
    server.listen(0, resolve)
  })
  const addr = server.address() as { port: number }
  port = addr.port
})

afterAll(() => {
  server.close()
})

runIdPTestSuite({
  baseUrl: () => `http://localhost:${port}`,
  managementToken: MGMT,
})
