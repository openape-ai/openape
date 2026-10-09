// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ProtocolError } from '@openape/pods-protocol'
import { generateKey, proofBytes, publicKey, sha256, signBytes } from '@openape/pods-protocol/crypto'
import { RelayStore } from '../../../openape-pods-relay/server/utils/store'
import { RelayAuth } from '../../../openape-pods-relay/server/utils/auth'
import { InboxStore, parsePublication } from '../../../openape-pods-relay/server/utils/inbox-store'
import { RemoteController } from '../../src/main/remote/controller'
import { InboxOutbox, parseNotify } from '../../src/worker/inbox/outbox'
import type { InboxOutboxCommand, InboxPublication } from '../../src/worker/inbox/outbox'
import { parseInboxDecisions } from '../../src/contracts/inbox'
import type { InboxDecision } from '../../src/contracts/inbox'
import type { FixtureWorker } from '../../src/main/worker'
import { PodDatabase } from '../../src/worker/storage/database'
import { RemoteControl } from '../../src/worker/remote/control'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { MasterControl } from '../../src/worker/master/control'
import { MasterService } from '../../src/worker/master/service'
import type { AgentRuntime } from '../../src/worker/agent/executor'

const browser = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() }, shell: { openExternal: browser } }))
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); browser.mockReset() })

async function fixture() {
  vi.stubEnv('OPENAPE_PODS_CENTRAL_ENABLED', '1')
  const root = await mkdtemp(join(tmpdir(), 'pods-reauth-'))
  const relay = new RelayStore(':memory:')
  const store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, () => {})
  const runtime = {} as AgentRuntime
  const runs = new RunDispatcher(store, resources, runtime)
  const scheduler = new Scheduler(store, runs)
  const master = new MasterService(store, runtime, new MasterControl(store, resources, runs, scheduler, runtime))
  const remote = new RemoteControl(store, master, runs, resources, scheduler)
  const owner = { issuer: 'https://id.example.test', subject: 'owner@example.test' }
  const signing = generateKey(); const agreement = generateKey()
  const registration = relay.register(randomUUID(), owner, { signing: publicKey(signing), agreement: publicKey(agreement) })
  const first = relay.issue(registration.id)
  const proof = signBytes(proofBytes('session-refresh', registration.id, sha256(first.refreshToken)), signing)
  const rotated = relay.refresh(first.refreshToken, proof)
  expect(() => relay.refresh(first.refreshToken, proof)).toThrow('refresh_replay')
  const saved = { id: registration.id, signing, agreement, enabled: true, tokens: { ...first, expiresAt: new Date(0).toISOString() } }
  await mkdir(join(root, 'remote'), { recursive: true }); await writeFile(join(root, 'remote/registration.enc'), JSON.stringify(saved))
  await mkdir(join(root, 'central')); await writeFile(join(root, 'central/state.json'), '{"revision":17,"hash":"retained"}')
  await writeFile(join(root, 'central/publication.json'), '{"pending":"retained"}')
  await remote.execute({ type: 'configure', registration })
  const device = { id: randomUUID(), owner, keys: { signing: publicKey(generateKey()), agreement: publicKey(generateKey()) }, epoch: 1 }
  await remote.execute({ type: 'pair', device })
  const outbox = new InboxOutbox(store)
  const inbox = new InboxStore(':memory:')
  const worker = { inboxOutbox: vi.fn(async (command: InboxOutboxCommand) => outbox.execute(command)), remote: vi.fn(remote.execute.bind(remote)), remoteOwner: async () => ({ owner, email: owner.subject }), indexRemotePods: vi.fn(async () => {}) }
  const auth = new RelayAuth(relay, 'https://pods.example.test')
  browser.mockImplementation(async (url: string) => {
    const id = new URL(url).searchParams.get('id')!
    const row = relay.db.prepare('SELECT body FROM auth_flows WHERE id=?').get(id)!
    relay.db.prepare('UPDATE auth_flows SET body=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(String(row.body)), owner }), id)
  })
  const requests: string[] = []
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; requests.push(path)
    const body = JSON.parse(String(init.body ?? '{}'))
    try {
      if (path.endsWith('/session/refresh')) return Response.json(relay.refresh(body.refreshToken, body.signature))
      if (path.endsWith('/session/begin')) return Response.json(auth.begin(body))
      if (path.endsWith('/session/exchange')) return Response.json(auth.exchange(body))
      if (path.endsWith('/registration')) {
        const h = new Headers(init.headers)
        return Response.json(relay.authenticateRequest(h.get('authorization')!.slice(7), 'GET', path, { id: h.get('x-pods-request-id')!, at: h.get('x-pods-request-at')!, digest: h.get('x-pods-body-digest')!, signature: h.get('x-pods-proof')! }))
      }
      if (path === '/api/runtime/v1/inbox/decisions') {
        const h = new Headers(init.headers)
        const caller = relay.authenticateRequest(h.get('authorization')!.slice(7), 'POST', path, { id: h.get('x-pods-request-id')!, at: h.get('x-pods-request-at')!, digest: h.get('x-pods-body-digest')!, signature: h.get('x-pods-proof')! })
        if (h.get('x-pods-body-digest') !== sha256(String(init.body))) throw new ProtocolError('invalid_request_body', 401)
        return Response.json(inbox.syncDecisions(caller.owner, caller.id, parseInboxDecisions(body)))
      }
      if (path === '/api/runtime/v1/inbox') {
        const h = new Headers(init.headers)
        const caller = relay.authenticateRequest(h.get('authorization')!.slice(7), 'POST', path, { id: h.get('x-pods-request-id')!, at: h.get('x-pods-request-at')!, digest: h.get('x-pods-body-digest')!, signature: h.get('x-pods-proof')! })
        if (h.get('x-pods-body-digest') !== sha256(String(init.body))) throw new ProtocolError('invalid_request_body', 401)
        return Response.json(inbox.publish(caller.owner, caller.id, parsePublication(body)))
      }
      throw new Error(`Unexpected route ${path}`)
    }
    catch (error) { if (error instanceof ProtocolError) return Response.json({ code: error.code }, { status: error.status }); throw error }
  })
  vi.stubGlobal('fetch', fetcher)
  const controller = new RemoteController(root, worker as unknown as FixtureWorker, 'https://pods.example.test')
  cleanups.push(async () => { await controller.stop(); relay.close(); inbox.close(); store.close(); await rm(root, { recursive: true, force: true }) })
  const readSaved = async () => JSON.parse(await readFile(join(root, 'remote/registration.enc'), 'utf8')) as typeof saved
  const revoke = () => { relay.db.prepare('UPDATE registrations SET revoked=1 WHERE id=?').run(registration.id) }
  return { root, relay, store, remote, outbox, inbox, owner, registration, saved, rotated, worker, controller, requests, fetcher, readSaved, revoke, enable: () => controller.enable({ owner, email: owner.subject }) }
}

it('reauthenticates a replay-revoked session with the same runtime, keys, generation and pairing', async () => {
  const f = await fixture()
  const devices = f.store.db.prepare('SELECT * FROM remote_devices').all()
  const registration = f.relay.registration(f.registration.id)
  await f.enable()
  const saved = await f.readSaved()
  expect(saved).toMatchObject({ id: f.saved.id, signing: f.saved.signing, agreement: f.saved.agreement, enabled: true })
  expect(saved.tokens.registration).toEqual({ id: registration.id, generation: registration.generation, owner: f.owner })
  expect(f.relay.authenticate(saved.tokens.accessToken)).toEqual(registration)
  expect(() => f.relay.authenticate(f.rotated.accessToken)).toThrow('authentication_required')
  expect(f.store.db.prepare('SELECT * FROM remote_devices').all()).toEqual(devices)
  expect(await readFile(join(f.root, 'central/state.json'), 'utf8')).toBe('{"revision":17,"hash":"retained"}')
  expect(await readFile(join(f.root, 'central/publication.json'), 'utf8')).toBe('{"pending":"retained"}')
  expect(f.requests).not.toContain('/api/runtime/v1/rotate')
  expect(browser).toHaveBeenCalledTimes(1)
  await f.enable()
  expect(browser).toHaveBeenCalledTimes(1)
  expect(f.relay.db.prepare('SELECT count(*) AS count FROM registrations').get()?.count).toBe(1)
})

it('refuses revoked devices without replacing their identity or opening enrollment', async () => {
  const f = await fixture(); f.revoke()
  await expect(f.enable()).rejects.toThrow('registration_unavailable')
  expect(await f.readSaved()).toEqual({ ...f.saved, enabled: false })
  expect(browser).not.toHaveBeenCalled()
  expect(f.worker.remote.mock.calls.some(([c]) => c.type === 'configure')).toBe(false)
})

it.each(['owner', 'generation', 'missing'] as const)('refuses a local %s mismatch before changing identity or requesting login', async (mismatch) => {
  const f = await fixture()
  if (mismatch === 'missing') f.store.db.exec('DELETE FROM remote_registration')
  else f.store.db.prepare('UPDATE remote_registration SET body=?').run(JSON.stringify({ ...f.registration, ...(mismatch === 'owner' ? { owner: { ...f.owner, subject: 'someone-else' } } : { generation: randomUUID() }) }))
  await expect(f.enable()).rejects.toThrow(/registration|identity/)
  expect(await f.readSaved()).toEqual(f.saved)
  expect(f.requests).toEqual([])
})

it('refuses a changed relay generation without rotating or overwriting local registration', async () => {
  const f = await fixture(); f.relay.db.prepare('UPDATE registrations SET generation=? WHERE id=?').run(randomUUID(), f.registration.id)
  await expect(f.enable()).rejects.toThrow('differs from the existing workspace')
  expect(await f.readSaved()).toEqual({ ...f.saved, enabled: false })
  expect(f.worker.remote.mock.calls.some(([c]) => c.type === 'configure')).toBe(false)
})

it('reports terminal registration conflicts rather than polling them as pending login', async () => {
  const f = await fixture()
  browser.mockImplementationOnce(async () => { f.revoke() })
  const normal = f.fetcher.getMockImplementation()!
  f.fetcher.mockImplementation(async (url, init) => url.endsWith('/exchange') ? Response.json({ code: 'registration_conflict' }, { status: 409 }) : normal(url, init))
  await expect(f.enable()).rejects.toThrow('registration_conflict')
  expect(f.requests.filter(x => x.endsWith('/session/begin'))).toHaveLength(1)
  expect(await f.readSaved()).toEqual({ ...f.saved, enabled: false })
})

it('retains identity and does not request browser login for transient relay failures', async () => {
  const f = await fixture()
  f.fetcher.mockImplementationOnce(async () => Response.json({ code: 'unavailable' }, { status: 503 }))
  await expect(f.enable()).rejects.toThrow('503')
  expect(await f.readSaved()).toEqual({ ...f.saved, enabled: false })
  expect(browser).not.toHaveBeenCalled()
})

it('delivers queued Pod notifications once with the signed runtime session and keeps conflicts final', async () => {
  const f = await fixture()
  await f.enable()
  const pod = f.store.createPod({ name: 'Belege' })
  const queued = f.outbox.queue(pod, randomUUID(), parseNotify({ key: 'invoice-42', title: 'Rechnung abgelegt', body: 'Rechnung 42 liegt im Archiv.' }))
  await f.controller.deliverInbox()
  expect(f.inbox.list(f.owner).items.map(item => [item.title, item.pod?.name])).toEqual([['Rechnung abgelegt', 'Belege']])
  expect(f.outbox.execute({ type: 'status' })).toEqual({ pending: 0, refused: [] })
  // A lost acknowledgement retries the identical event; the inbox returns the stored receipt instead of a duplicate.
  const publication = JSON.parse(String(f.store.db.prepare('SELECT publication FROM inbox_outbox WHERE event_id=?').get(queued.eventId)?.publication)) as InboxPublication
  expect(f.inbox.publish(f.owner, f.registration.id, parsePublication(publication))).toMatchObject({ created: false })
  // Changed content under an already delivered event is refused by the inbox and stays refused, never resent.
  f.store.db.prepare('UPDATE inbox_outbox SET state=\'pending\',publication=? WHERE event_id=?').run(JSON.stringify({ ...publication, body: 'Geändert' }), queued.eventId)
  await f.controller.deliverInbox()
  expect(f.outbox.execute({ type: 'status' })).toMatchObject({ pending: 0, refused: [{ eventId: queued.eventId, reason: expect.stringContaining('inbox_event_conflict') }] })
  expect(f.inbox.list(f.owner).items).toHaveLength(1)
})

it('publishes the owner decision set with the signed runtime session only when it changed', async () => {
  const f = await fixture()
  await f.enable()
  const decision: InboxDecision = { sourceId: 'secret:request-1', type: 'secret', digest: 'a'.repeat(64), podId: null, podName: null, title: 'Geheimnis imap', body: 'Postfach lesen', authority: 'secrets', options: [{ key: 'cancel', title: 'Abbrechen', input: null }], link: { title: 'Ausfüllen', url: 'https://secrets.openape.ai/' } }
  let current = [decision]
  const publish = () => f.controller.publishDecisions(async () => current)
  await publish()
  expect(f.inbox.list(f.owner, { kind: 'decision' }).items).toMatchObject([{ state: 'open', title: 'Geheimnis imap', decision: { runtimeId: f.registration.id, authority: 'secrets' }, links: [{ url: 'https://secrets.openape.ai/' }] }])
  await publish()
  expect(f.requests.filter(path => path.endsWith('/inbox/decisions'))).toHaveLength(1)
  current = []
  await publish()
  expect(f.inbox.list(f.owner, { kind: 'decision' }).items).toMatchObject([{ state: 'resolved' }])
})
