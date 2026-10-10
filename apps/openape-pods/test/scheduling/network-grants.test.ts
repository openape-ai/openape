// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { PodGrant } from '../../src/contracts/grants'
import type { ResourceState } from '../../src/contracts/resources'
import { releaseArchivedNetworkGrants } from '../../src/main/grants/administration'
import type { PodGrants } from '../../src/main/grants/pod-grants'
import { GrantLedger } from '../../src/worker/resources/grants'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

const detail = (origin: string) => ({ type: 'openape_cli' as const, cli_id: 'pod-http', operation_id: 'request', resource_chain: [{ resource: 'https-origin', selector: { url: origin } }], action: 'request', permission: `pod-http.https-origin[url=${origin}]#request`, display: `HTTP requests to ${origin}`, risk: 'high' as const })
const grant = (id: string, podId: string, origin: PodGrant['origin']): PodGrant => ({ id, podId, issuer: 'https://id.example.invalid', subject: `pod-${podId}`, cliId: 'pod-http', details: [detail('https://chat.example.com')], display: 'HTTP requests to https://chat.example.com', grantType: 'always', state: 'approved', origin, approvedInSession: true, createdAt: 1, updatedAt: 1 })

it('revokes the grants and removes the sandbox a network handed to its members when the network is archived', async () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['mail'], summary: 'Finds mail' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['mail'], gives: [], summary: 'Posts mail' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['mail'])
  const ledger = new GrantLedger(f.store)
  ledger.record(grant('network-source', source, { networkId: id, revision: 1 }))
  ledger.record(grant('network-consumer', consumer, { networkId: id, revision: 1 }))
  ledger.record(grant('own-consumer', consumer, null))
  // A later record of the same grant (a run observing it) never moves it between the Pod and the network.
  ledger.record({ ...grant('own-consumer', consumer, { networkId: id, revision: 1 }), state: 'approved' })
  const resource = f.resources.assignHttp(consumer, { origin: 'https://chat.example.com', methods: ['POST'] }, f.resources.epoch(consumer))
  ledger.execute({ type: 'networkResource', networkId: id, revision: 1, podId: consumer, resourceId: resource })
  ledger.level(consumer, `network:${id}`, 1, 'owner')
  expect(ledger.sandbox(consumer).level).toBe('owner')
  expect(ledger.released()).toEqual({ grants: [], resources: [] })

  const review = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: review.fingerprint })
  expect(ledger.sandbox(consumer)).toEqual({ level: 'isolated', sources: [] })
  expect(ledger.released().grants.map(item => item.id).sort()).toEqual(['network-consumer', 'network-source'])

  const revoked: string[] = []
  const grants = { revoke: async (podId: string, grantId: string) => { revoked.push(grantId); ledger.state(podId, grantId, 'revoked'); return {} } } as unknown as PodGrants
  const state = (podId: string) => ({ resources: f.resources.list(podId), epoch: f.resources.epoch(podId) }) as ResourceState
  await releaseArchivedNetworkGrants({ grants, ledger: async command => ledger.execute(command), resources: async podId => state(podId), revokeResource: async (podId, resourceId, revision) => f.resources.revoke(podId, resourceId, revision) }, AbortSignal.timeout(5000))
  expect(revoked.sort()).toEqual(['network-consumer', 'network-source'])
  expect(ledger.list(consumer).map(item => [item.id, item.state])).toEqual(expect.arrayContaining([['own-consumer', 'approved'], ['network-consumer', 'revoked']]))
  expect(f.resources.list(consumer).find(item => item.id === resource)?.state).toBe('revoked')
  expect(ledger.released()).toEqual({ grants: [], resources: [] })
})

it('returns a member to its own sandbox when the network that raised it to owner is archived or revised', async () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['mail'], summary: 'Finds mail' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['mail'], gives: [], summary: 'Posts mail' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['mail'])
  const ledger = new GrantLedger(f.store)
  const own = f.resources.assignHttp(consumer, { origin: 'https://own.example.com', methods: ['GET'] }, f.resources.epoch(consumer))
  ledger.level(consumer, 'pod', null, 'isolated')
  const networkOrigin = f.resources.assignHttp(consumer, { origin: 'https://chat.example.com', methods: ['POST'] }, f.resources.epoch(consumer))
  ledger.execute({ type: 'networkResource', networkId: id, revision: 1, podId: consumer, resourceId: networkOrigin })
  const ownOnly = { level: 'isolated', sources: [{ source: 'pod', level: 'isolated' }] }
  ledger.level(consumer, `network:${id}`, 0, 'owner')
  expect(ledger.sandbox(consumer)).toEqual(ownOnly)
  ledger.level(consumer, `network:${id}`, 1, 'owner')
  expect(ledger.sandbox(consumer).level).toBe('owner')

  const review = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: review.fingerprint })
  // A declaration that read the network before its archive and records the level afterwards.
  ledger.level(consumer, `network:${id}`, 1, 'owner')
  expect(ledger.sandbox(consumer)).toEqual(ownOnly)

  const state = (podId: string) => ({ resources: f.resources.list(podId), epoch: f.resources.epoch(podId) }) as ResourceState
  await releaseArchivedNetworkGrants({ grants: {} as PodGrants, ledger: async command => ledger.execute(command), resources: async podId => state(podId), revokeResource: async (podId, resourceId, revision) => f.resources.revoke(podId, resourceId, revision) }, AbortSignal.timeout(5000))
  expect(f.store.db.prepare('SELECT source FROM pod_sandbox WHERE pod_id=?').all(consumer).map(item => item.source)).toEqual(['pod'])
  expect(ledger.sandbox(consumer)).toEqual(ownOnly)
  expect(f.resources.list(consumer).find(item => item.id === networkOrigin)?.state).toBe('revoked')
  expect(f.resources.list(consumer).find(item => item.id === own)?.state).toBe('ready')
})
