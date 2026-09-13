// @vitest-environment node
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createApp, createRouter, toNodeListener } from 'h3'
import { createStorage } from 'unstorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

const storages = new Map<string, ReturnType<typeof createStorage>>()
vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeGrants: { storageKey: 'pod-provisioning-grants' }, openapeIdp: { storageKey: 'pod-provisioning', issuer: 'https://id.openape.test', managementToken: '', adminEmails: '' } }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    let storage = storages.get(key)
    if (!storage) { storage = createStorage(); storages.set(key, storage) }
    return storage
  },
}))
const owner = 'owner@example.test'
let server: Server | undefined
let origin = ''
let token = ''
const fixtureBody = () => ({ podId: randomUUID(), name: 'Synthetic pod', publicKey: generateSshEd25519Key('fixture').publicKeySsh })
async function request(body: unknown, bearer = token) {
  return fetch(`${origin}/api/pods/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) })
}
beforeEach(async () => {
  for (const storage of storages.values()) await storage.clear()
  const { useIdpStores } = await import('../src/runtime/server/utils/stores')
  const { issueAuthToken } = await import('../src/runtime/server/utils/agent-token')
  const stores = useIdpStores()
  await stores.userStore.create({ email: owner, name: 'Owner', type: 'human', isActive: true, createdAt: 1 })
  const { definePodIdentityStore } = await import('../src/runtime/server/utils/pod-identity-store')
  const { createProblemError } = await import('../src/runtime/server/utils/problem')
  definePodIdentityStore(() => ({ provision: async (input) => {
    const existing = await stores.userStore.findByEmail(input.email)
    const keys = await stores.sshKeyStore.findByUser(input.email)
    if (existing) {
      if (!existing.isActive || existing.owner !== input.owner || keys.length !== 1 || keys[0]?.keyId !== input.keyId) throw createProblemError({ status: 409, title: 'Identity conflict' })
      return
    }
    if (await stores.sshKeyStore.findById(input.keyId)) throw createProblemError({ status: 409, title: 'Key conflict' })
    await stores.userStore.create({ email: input.email, name: input.name, owner: input.owner, approver: input.owner, type: 'agent', isActive: true, createdAt: 1 })
    await stores.sshKeyStore.save({ keyId: input.keyId, userEmail: input.email, publicKey: input.publicKey, name: input.name, createdAt: 1 })
  } }))
  const signing = await stores.keyStore.getSigningKey()
  token = await issueAuthToken({ sub: owner, act: 'human' }, 'https://id.openape.test', signing.privateKey, signing.kid)
  const { default: provision } = await import('../src/runtime/server/api/pods/agents.post')
  const { default: status } = await import('../src/runtime/server/api/pods/agents/[email].get')
  const app = createApp(); const router = createRouter()
  router.post('/api/pods/agents', provision); router.get('/api/pods/agents/:email', status); app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local IdP listener')
  origin = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())) })
describe('owner-scoped pod identity over HTTP', () => {
  it('provisions an owned agent without admin privilege or seeded grants and repeats idempotently', async () => {
    const body = fixtureBody()
    const first = await request(body); expect(first.status).toBe(200)
    const identity = await first.json() as { email: string, owner: string, permissions: string }
    expect(identity.owner).toBe(owner); expect(identity.permissions).toBe('none')
    const repeated = await request(body); expect(repeated.status).toBe(200); expect(await repeated.json()).toEqual(identity)
    const { useIdpStores } = await import('../src/runtime/server/utils/stores')
    const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
    expect(await useIdpStores().userStore.findByEmail(identity.email)).toMatchObject({ owner, approver: owner, type: 'agent', isActive: true })
    expect(await useGrantStores().grantStore.findByRequester(identity.email)).toEqual([])
    expect(await useIdpStores().sshKeyStore.findByUser(identity.email)).toHaveLength(1)
  })
  it('rejects unauthenticated callers, agents, inactive owners and substituted owner fields', async () => {
    expect((await request(fixtureBody(), '')).status).toBe(401)
    const { useIdpStores } = await import('../src/runtime/server/utils/stores')
    const { issueAuthToken } = await import('../src/runtime/server/utils/agent-token')
    const signing = await useIdpStores().keyStore.getSigningKey()
    const agent = await issueAuthToken({ sub: owner, act: 'agent' }, 'https://id.openape.test', signing.privateKey, signing.kid)
    expect((await request(fixtureBody(), agent)).status).toBe(403)
    expect((await request({ ...fixtureBody(), owner: 'other@example.test' })).status).toBe(400)
    await useIdpStores().userStore.update(owner, { isActive: false })
    expect((await request(fixtureBody())).status).toBe(403)
  })
  it('rejects malformed keys and conflicting identity retries', async () => {
    expect((await request({ ...fixtureBody(), publicKey: 'ssh-ed25519 invalid' })).status).toBe(400)
    const body = fixtureBody(); expect((await request(body)).status).toBe(200)
    expect((await request({ ...body, publicKey: fixtureBody().publicKey })).status).toBe(409)
  })
  it('does not reactivate a disabled pod or reuse a key for another pod', async () => {
    const body = fixtureBody()
    const response = await request(body)
    expect(response.status).toBe(200)
    const identity = await response.json() as { email: string }
    expect((await request({ ...body, podId: randomUUID() })).status).toBe(409)
    const { useIdpStores } = await import('../src/runtime/server/utils/stores')
    await useIdpStores().userStore.update(identity.email, { isActive: false })
    expect((await request(body)).status).toBe(409)
    expect(await useIdpStores().userStore.findByEmail(identity.email)).toMatchObject({ isActive: false })
  })

  it('reports current grant/key/owner status only to the owner or the exact pod identity', async () => {
    const response = await request(fixtureBody()); const identity = await response.json() as { email: string, keyId: string }
    const { useIdpStores } = await import('../src/runtime/server/utils/stores')
    const { useGrantStores } = await import('../src/runtime/server/utils/grant-stores')
    const { issueAuthToken } = await import('../src/runtime/server/utils/agent-token')
    const stores = useIdpStores(); const signing = await stores.keyStore.getSigningKey()
    await useGrantStores().grantStore.save({ id: 'assigned', status: 'approved', created_at: 1, request: { requester: identity.email, target_host: 'fixture', audience: 'shapes', grant_type: 'always' } })
    const agent = await issueAuthToken({ sub: identity.email, act: 'agent' }, 'https://id.openape.test', signing.privateKey, signing.kid)
    const status = async (bearer: string) => fetch(`${origin}/api/pods/agents/${encodeURIComponent(identity.email)}?grant=assigned`, { headers: { Authorization: `Bearer ${bearer}` } })
    expect(await (await status(agent)).json()).toMatchObject({ email: identity.email, active: true, grantActive: true, keyIds: [identity.keyId] })
    const foreign = await issueAuthToken({ sub: 'foreign@example.test', act: 'agent' }, 'https://id.openape.test', signing.privateKey, signing.kid)
    expect((await status(foreign)).status).toBe(403)
    await useGrantStores().grantStore.updateStatus('assigned', 'revoked')
    expect(await (await status(agent)).json()).toMatchObject({ grantActive: false })
    await stores.sshKeyStore.delete(identity.keyId)
    await stores.userStore.update(owner, { isActive: false })
    expect(await (await status(agent)).json()).toMatchObject({ active: false, keyIds: [] })
  })

})
