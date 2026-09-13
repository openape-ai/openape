import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { resolve } from 'node:path'
import { signJWT } from '@openape/core'
import { loadAdapter, resolveCommand } from '@openape/shapes'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authorizeAssignedCommand } from '../src/shapes/assigned'
import type { AssignedGrantScope } from '../src/shapes/grants'

const keys = generateKeyPairSync('ed25519')
const adapterPath = resolve('../shapes/test/fixtures/gh.toml')
const adapter = loadAdapter('gh', adapterPath)
const resolved = await resolveCommand(adapter, ['gh', 'repo', 'list', 'openape'])
const command = { cliId: 'gh', adapterPath, adapterDigest: adapter.digest, argv: resolved.executionContext.argv!, permission: resolved.permission }
let server: Server
let scope: AssignedGrantScope
let consumeStatus = 'valid'
let requests: string[]
async function token(overrides: Record<string, unknown> = {}, signingKey = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000)
  return signJWT({ iss: scope.issuer, sub: scope.subject, aud: 'shapes', target_host: scope.targetHost, grant_id: scope.grantId, grant_type: 'always', iat: now, exp: now + 60, jti: 'fixture-jti', authorization_details: [resolved.detail], execution_context: resolved.executionContext, ...overrides }, signingKey, { kid: 'fixture-key' })
}
beforeEach(async () => {
  consumeStatus = 'valid'; requests = []
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/jwks') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'EdDSA', use: 'sig' }] })); return }
    if (request.url === '/grants/assigned-grant/consume' && request.method === 'POST') { response.end(JSON.stringify(consumeStatus === 'valid' ? { status: 'valid' } : { error: consumeStatus })); return }
    response.statusCode = 404; response.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const issuer = `http://127.0.0.1:${address.port}`
  scope = { issuer, subject: 'pod@example.test', targetHost: 'pods-fixture', grantId: 'assigned-grant', jwksUri: `${issuer}/jwks`, grantsEndpoint: `${issuer}/grants` }
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
describe('assigned ape-shell authorization with signed grants', () => {
  it('uses only the pinned adapter and assigned grant without discovery, grant creation or shell execution', async () => {
    expect((await authorizeAssignedCommand(command, await token(), scope)).permission).toBe(command.permission)
    expect(requests).toEqual(['GET /jwks', 'POST /grants/assigned-grant/consume'])
  })
  it('rejects forged signatures and substitutions of identity, host, grant, issuer, audience and adapter', async () => {
    for (const override of [{ sub: 'owner@example.test' }, { target_host: 'elsewhere' }, { grant_id: 'unassigned' }, { iss: 'https://elsewhere.test' }, { aud: 'other' }, { execution_context: { ...resolved.executionContext, adapter_digest: 'SHA-256:changed' } }, { run_as: 'root' }, { exp: 1 }]) {
      await expect(authorizeAssignedCommand(command, await token(override), scope)).rejects.toThrow()
    }
    await expect(authorizeAssignedCommand(command, await token({}, generateKeyPairSync('ed25519').privateKey), scope)).rejects.toThrow()
    expect(requests.some(request => request.startsWith('POST'))).toBe(false)
  })
  it('fails closed on revocation, unknown commands, changed adapters and foreign endpoints', async () => {
    consumeStatus = 'revoked'
    await expect(authorizeAssignedCommand(command, await token(), scope)).rejects.toThrow('revoked')
    await expect(authorizeAssignedCommand({ ...command, argv: ['bash', '-c', 'anything'] }, await token(), scope)).rejects.toThrow()
    await expect(authorizeAssignedCommand({ ...command, argv: ['gh', 'repo', 'list', 'foreign'] }, await token(), scope)).rejects.toThrow('assigned operation')
    await expect(authorizeAssignedCommand({ ...command, adapterDigest: `SHA-256:${'0'.repeat(64)}` }, await token(), scope)).rejects.toThrow('integrity')
    await expect(authorizeAssignedCommand(command, await token(), { ...scope, grantsEndpoint: 'https://foreign.test/grants' })).rejects.toThrow('origin')
    expect(requests.filter(request => request.startsWith('POST'))).toHaveLength(1)
  })
})
