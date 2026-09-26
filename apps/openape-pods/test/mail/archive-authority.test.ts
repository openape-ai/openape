// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { archiveCommand, archiveSummary } from '../../src/contracts/mail-archive'
import type { ArchiveRecord } from '../../src/contracts/mail-archive'
import { createArchiveAuthority } from '../../src/main/mail/archive/authority'
import type { AgentConnection } from '../../src/main/broker/authorization'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const podId = randomUUID()
  const record: ArchiveRecord = { state: 'pending', grantId: randomUUID(), outcomes: [], manifest: { version: 1, id: randomUUID(), podId, applicationId: randomUUID(), applicationHash: 'pinned', mailbox: 'owner@example.test', expiresAt: Date.now() + 600000, items: [{ id: 'message', version: 'v1', folder: 'inbox', internetMessageId: '<fixture@example.test>', sender: 'sender@example.test', subject: 'Reviewed message', receivedAt: '2026-09-26T05:00:00Z', url: 'https://outlook.office.com/mail/id/one', reason: 'Completed' }] } }
  const connection: AgentConnection = { subject: 'agent@example.test', owner: 'owner@example.test', issuer: 'https://id.example.test', targetHost: `pods:${podId}`, keyId: 'key', accessToken: async () => 'synthetic-only' }
  const grant = { id: record.grantId, status: 'approved', decided_by: connection.owner, request: { requester: connection.subject, target_host: connection.targetHost, audience: 'pods-mail-archive', grant_type: 'once', waits_until: Math.floor(record.manifest.expiresAt / 1000), command: archiveCommand(record.manifest), summary: { text: archiveSummary(record.manifest) } } }
  const fetch = vi.fn(async () => Response.json(grant)); vi.stubGlobal('fetch', fetch)
  return { record, grant, fetch, authority: createArchiveAuthority(connection, new AbortController().signal, async () => {}) }
}
it('accepts only the exact manually approved archive batch', async () => {
  const f = fixture(); expect(await f.authority.status(f.record)).toBe('approved')
  f.grant.request.command = ['pods-mail-archive', 'archive', 'different-message']
  await expect(f.authority.status(f.record)).rejects.toThrow('differs')
})
it.each(['auto_approval_kind', 'decided_by_standing_grant'])('refuses automatic grants marked by %s', async (field) => {
  const f = fixture(); f.fetch.mockResolvedValue(Response.json({ ...f.grant, [field]: 'automatic' }))
  await expect(f.authority.status(f.record)).rejects.toThrow('manual owner')
})
it('rejects reusable grants and approvals by another owner', async () => {
  const f = fixture(); f.grant.request.grant_type = 'always'; await expect(f.authority.status(f.record)).rejects.toThrow('differs')
  f.grant.request.grant_type = 'once'; f.grant.decided_by = 'other@example.test'; await expect(f.authority.status(f.record)).rejects.toThrow('manual owner')
})

it('verifies a signed exact-batch token and refuses a signed token for different mail', async () => {
  const { createServer } = await import('node:http')
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const { computeCmdHash } = await import('@openape/core')
  const f = fixture(); vi.unstubAllGlobals()
  const keys = generateKeyPairSync('ed25519'); let origin = ''; let substitute = true; let consumes = 0
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const reply = (value: unknown) => response.end(JSON.stringify(value))
    if (request.url === '/.well-known/jwks.json') { reply({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'EdDSA' }] }); return }
    if (request.url?.endsWith('/token')) {
      const command = substitute ? ['pods-mail-archive', 'different-batch'] : f.grant.request.command
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'fixture' })).toString('base64url')
      const claims = { iss: origin, sub: f.grant.request.requester, aud: f.grant.request.audience, target_host: f.grant.request.target_host, grant_id: f.record.grantId, grant_type: 'once', decided_by: f.grant.decided_by, command, cmd_hash: await computeCmdHash(command.join(' ')), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, jti: randomUUID() }
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url'); reply({ authz_jwt: `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}` }); return
    }
    if (request.url?.endsWith('/consume')) { consumes++; reply({ status: 'consumed' }); return }
    reply(f.grant)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address missing')
    origin = `http://127.0.0.1:${address.port}`
    const authority = createArchiveAuthority({ issuer: origin, subject: f.grant.request.requester, targetHost: f.grant.request.target_host, owner: f.grant.decided_by, keyId: 'fixture', accessToken: async () => 'synthetic-only' }, new AbortController().signal, async () => {})
    await expect(authority.consume(f.record)).rejects.toThrow('exact batch'); expect(consumes).toBe(0)
    substitute = false; await authority.consume(f.record); expect(consumes).toBe(1)
  }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
