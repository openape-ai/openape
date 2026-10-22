import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestAuthenticator } from '../../../packages/auth/src/__tests__/webauthn-test-authenticator'
import type { Principal } from '../server/vault/types'
import type { Recovery } from '../app/utils/vault-engine'
import type { WrappedKey } from '@openape/ape-secrets/vault'
import { bytes, fingerprint, openDelivery, randomKey, sealDelivery } from '@openape/ape-secrets/vault'
import { createVaultEngine } from '../app/utils/vault-engine'
import { VaultStore } from '../server/vault/store'
import { VaultService } from '../server/vault/service'

const owner: Principal = { subject: 'owner@example.org', actor: 'owner@example.org', act: 'human', authentication: 'session', session: 'session-one' }
const agent: Principal = { subject: 'owner@example.org', actor: 'agent@example.org', act: 'agent', authentication: 'bearer', session: '' }
const rp = { rpName: 'Secrets', rpID: 'secrets.example.org', origin: 'https://secrets.example.org', requireUserVerification: true }
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'secrets-test-'))
  const client = createClient({ url: `file:${join(dir, 'vault.db')}` })
  cleanup.push(async () => { client.close(); await rm(dir, { recursive: true, force: true }) })
  const store = new VaultStore(client)
  await store.initialize()
  await client.execute('CREATE TABLE consumers (id TEXT PRIMARY KEY, owner_email TEXT, name TEXT, public_key_jwk TEXT, allowed_requesters TEXT)')
  let now = 1700000000000
  const service = new VaultService(store, rp, () => now)
  const authenticator = createTestAuthenticator()
  let counter = 0
  const proof = (challenge: string, extra = {}) => authenticator.createAuthenticationResponse({ challenge, origin: rp.origin, rpId: rp.rpID, counter: ++counter, ...extra })
  const initial = await service.setupOptions(owner)
  const next = await service.register(owner, { challengeId: initial.challengeId, response: authenticator.createRegistrationResponse({ challenge: initial.options.challenge, origin: rp.origin, rpId: rp.rpID }) }, 'setup')
  // Software authenticator verifies WebAuthn signatures; this random stand-in
  // does NOT constitute hardware/browser PRF compatibility evidence.
  const prf = randomKey()
  const engine = createVaultEngine()
  const kit = await engine({ type: 'setup', owner: owner.subject, credentialId: next.credentialId, prf: prf.slice() }) as { code: string, wrapper: WrappedKey, recovery: Recovery }
  await service.confirm(owner, { challengeId: next.challengeId, response: proof(next.options.challenge), wrapper: kit.wrapper, recovery: kit.recovery }, 'setup-confirm')
  async function options(action: Record<string, unknown>) { return service.actionOptions(owner, { credentialId: authenticator.credentialId, action }) }
  async function commit(c: Awaited<ReturnType<typeof options>>, extra = {}) { return service.actionCommit(owner, { challengeId: c.challengeId, response: proof(c.options.challenge), ...extra }) }
  async function save(value = 'private-api-token', secretId?: string) {
    const c = await options({ type: 'save', alias: 'API_TOKEN', ...(secretId ? { secretId } : {}) })
    if (c.action.type !== 'save') throw new Error('wrong action')
    const payload = await engine({ type: 'save', owner: owner.subject, value, secretId: c.action.secretId, version: c.action.version })
    await commit(c, { payload })
    return c.action.secretId
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
  await client.execute({ sql: 'INSERT INTO consumers VALUES (?,?,?,?,?)', args: ['machine', owner.subject, 'Machine', JSON.stringify(pub), JSON.stringify([agent.actor])] })
  await commit(await options({ type: 'bind', consumerId: 'machine', collector: agent.actor }))
  async function approve(mode = 'once', alias = 'API_TOKEN') {
    const request = await service.request(agent, { consumerId: 'machine', alias })
    const c = await options({ type: 'approve', requestId: request.id, mode, duration: 60 })
    if (c.action.type !== 'approve') throw new Error('wrong action')
    const envelope = await sealDelivery(pub, bytes('private-api-token'), c.action.descriptor)
    await commit(c, { envelope })
    return { request, c, envelope, approvalId: c.action.descriptor.approvalId }
  }
  return { databaseUrl: `file:${join(dir, 'vault.db')}`, service, store, client, authenticator, proof, options, commit, save, approve, priv, pub, kit, prf, engine, advance: (ms: number) => { now += ms } }
}

describe('PRF vault boundary', () => {
  it('stores ciphertext only and releases a value without giving the recipient a vault key', async () => {
    const f = await fixture()
    await f.save()
    const a = await f.approve()
    const picked = await f.service.collect(agent, a.approvalId, 'machine')
    expect(new TextDecoder().decode(await openDelivery(f.priv, picked.envelope, picked.descriptor))).toBe('private-api-token')
    const dump = JSON.stringify(await f.service.view(owner))
    expect(dump).not.toContain('private-api-token')
    expect(dump).not.toContain(f.kit.code)
    expect(Object.keys(picked)).toEqual(['envelope', 'descriptor'])
    expect((await f.service.status(agent, a.request.id)).status).toBe('consumed')
  })
  it('allows only one concurrent retrieval, under contention', async () => {
    const f = await fixture()
    await f.save(); const a = await f.approve()
    const calls = await Promise.allSettled(Array.from({ length: 12 }, () => f.service.collect(agent, a.approvalId, 'machine')))
    expect(calls.filter(c => c.status === 'fulfilled')).toHaveLength(1)
    expect((await f.store.get<{ id: string, owner: string, envelope: unknown }>('approvals', a.approvalId))!.envelope).toBeNull()
  })
  it('does not duplicate a once release across independent database connections', async () => {
    const f = await fixture(); await f.save(); const a = await f.approve()
    const second = createClient({ url: f.databaseUrl })
    cleanup.unshift(async () => second.close())
    const other = new VaultService(new VaultStore(second), rp, () => 1700000000000)
    const results = await Promise.allSettled([f.service.collect(agent, a.approvalId, 'machine'), other.collect(agent, a.approvalId, 'machine')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  })
  it('requires human sessions for vault and approval operations', async () => {
    const f = await fixture()
    for (const p of [agent, { ...owner, authentication: 'bearer' as const }, { ...owner, actor: agent.actor }]) {
      await expect(f.service.view(p)).rejects.toThrow('Human browser session required')
      await expect(f.service.actionOptions(p, { credentialId: f.authenticator.credentialId, action: { type: 'unlock' } })).rejects.toThrow()
    }
    await expect(f.service.request({ ...agent, actor: 'foreign@example.org' }, { consumerId: 'machine', alias: 'API_TOKEN' })).rejects.toThrow()
  })
  it('rejects wrong origin, absent UV, wrong session, stale and replayed assertions', async () => {
    const f = await fixture()
    const c = await f.options({ type: 'unlock' })
    await expect(f.service.actionCommit(owner, { challengeId: c.challengeId, response: f.proof(c.options.challenge, { origin: 'https://evil.example' }) })).rejects.toThrow()
    await expect(f.service.actionCommit(owner, { challengeId: c.challengeId, response: f.proof(c.options.challenge, { userVerified: false }) })).rejects.toThrow()
    await expect(f.service.actionCommit({ ...owner, session: 'other' }, { challengeId: c.challengeId, response: f.proof(c.options.challenge) })).rejects.toThrow()
    await f.commit(c)
    await expect(f.commit(c)).rejects.toThrow('Expired or consumed')
    const expired = await f.options({ type: 'unlock' }); f.advance(300001)
    await expect(f.commit(expired)).rejects.toThrow('Expired or consumed')
  })
  it('refuses PRF output in any serialized assertion', async () => {
    const f = await fixture(); const c = await f.options({ type: 'unlock' })
    const response = { ...f.proof(c.options.challenge), clientExtensionResults: { prf: { results: { first: 'do-not-store' } } } }
    await expect(f.service.actionCommit(owner, { challengeId: c.challengeId, response })).rejects.toThrow('Do not transmit extension results')
  })
  it('freezes recipient, version and release duration before passkey verification', async () => {
    const f = await fixture(); await f.save()
    const request = await f.service.request(agent, { consumerId: 'machine', alias: 'API_TOKEN' })
    const c = await f.options({ type: 'approve', requestId: request.id, mode: 'once' })
    if (c.action.type !== 'approve') throw new Error('wrong action')
    const envelope = await sealDelivery(f.pub, bytes('secret'), { ...c.action.descriptor, mode: 'standing' })
    await expect(f.commit(c, { envelope })).rejects.toThrow('Envelope context mismatch')
    await expect(f.service.collect({ ...agent, actor: 'other' }, c.action.descriptor.approvalId, 'machine')).rejects.toThrow()
  })
  it('reuses timed releases without a browser and expires them', async () => {
    const f = await fixture(); await f.save(); const a = await f.approve('timed')
    await f.service.collect(agent, a.approvalId, 'machine')
    await f.service.collect(agent, a.approvalId, 'machine')
    expect((await f.service.request(agent, { consumerId: 'machine', alias: 'API_TOKEN' })).status).toBe('ready')
    f.advance(60001)
    await expect(f.service.collect(agent, a.approvalId, 'machine')).rejects.toThrow('no longer available')
    expect((await f.service.request(agent, { consumerId: 'machine', alias: 'API_TOKEN' })).status).toBe('pending_approval')
  })
  it('revokes standing releases and invalidates them on secret rotation', async () => {
    const f = await fixture(); const secretId = await f.save(); const a = await f.approve('standing')
    await f.service.revoke(owner, a.approvalId)
    await expect(f.service.collect(agent, a.approvalId, 'machine')).rejects.toThrow()
    const b = await f.approve('standing')
    await f.save('replacement', secretId)
    await expect(f.service.collect(agent, b.approvalId, 'machine')).rejects.toThrow()
    expect(await f.store.list('versions', owner.subject)).toHaveLength(2)
  })
  it('requires owner and fresh verification to rebind a consumer and invalidates prior releases', async () => {
    const f = await fixture(); await f.save(); const a = await f.approve('standing')
    const c = await f.options({ type: 'bind', consumerId: 'machine', collector: agent.actor })
    await f.client.execute('UPDATE consumers SET allowed_requesters=\'[]\' WHERE id=\'machine\'')
    await expect(f.commit(c)).rejects.toThrow('Consumer changed')
    await f.service.remove(owner, 'consumers', 'machine')
    await expect(f.service.collect(agent, a.approvalId, 'machine')).rejects.toThrow()
  })
  it('rejects request races against a secret replacement', async () => {
    const f = await fixture(); const secretId = await f.save()
    const r = await f.service.request(agent, { consumerId: 'machine', alias: 'API_TOKEN' })
    const c = await f.options({ type: 'approve', requestId: r.id, mode: 'once' })
    await f.save('rotated', secretId)
    await expect(f.commit(c, { envelope: {} })).rejects.toThrow('Secret changed')
  })
  it('lets only the requester cancel a pending request and rejects later approval', async () => {
    const f = await fixture()
    const r = await f.service.request(agent, { consumerId: 'machine', alias: 'API_TOKEN' })
    await expect(f.service.cancel({ ...agent, actor: 'other' }, r.id)).rejects.toThrow()
    await f.service.cancel(agent, r.id)
    expect((await f.service.status(agent, r.id)).status).toBe('cancelled')
    await expect(f.options({ type: 'approve', requestId: r.id, mode: 'once' })).rejects.toThrow('no longer pending')
  })
  it('supports ad-hoc values without creating a stored secret', async () => {
    const f = await fixture(); const a = await f.approve('once', 'ONE_TIME_CODE')
    expect((await f.service.view(owner)).secrets).toHaveLength(0)
    expect((await f.service.collect(agent, a.approvalId, 'machine')).descriptor.version).toBe(0)
  })
  it('recovers using independent proof and permits enrollment, without sending the recovery code', async () => {
    const f = await fixture()
    const challenge = await f.service.recoveryOptions(owner)
    const recovered = createVaultEngine()
    const signature = await recovered({ type: 'recover', owner: owner.subject, recovery: f.kit.recovery, code: f.kit.code, challengeId: challenge.challengeId, challenge: challenge.challenge })
    await expect(f.service.recoveryCommit({ ...owner, session: 'other' }, { challengeId: challenge.challengeId, signature })).rejects.toThrow()
    const registration = await f.service.recoveryCommit(owner, { challengeId: challenge.challengeId, signature })
    const second = createTestAuthenticator()
    const c = await f.service.register(owner, { challengeId: registration.challengeId, response: second.createRegistrationResponse({ challenge: registration.options.challenge, origin: rp.origin, rpId: rp.rpID }) }, 'enroll')
    const newPrf = randomKey()
    const wrapper = await recovered({ type: 'wrap', owner: owner.subject, credentialId: second.credentialId, prf: newPrf.slice() })
    await f.service.confirm(owner, { challengeId: c.challengeId, response: second.createAuthenticationResponse({ challenge: c.options.challenge, origin: rp.origin, rpId: rp.rpID }), wrapper }, 'enroll-confirm')
    expect((await f.service.view(owner)).credentials).toHaveLength(2)
    await f.service.remove(owner, 'credentials', f.authenticator.credentialId)
    await expect(f.options({ type: 'unlock' })).rejects.toThrow('Credential disabled')
    await expect(f.service.recoveryCommit(owner, { challengeId: challenge.challengeId, signature })).rejects.toThrow()
    expect(await fingerprint(f.pub)).toBe((await f.service.view(owner)).consumers[0]!.fingerprint)
  })
})
