// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateDigest, gateItemCommand, parseGateCoverage, parseGateManifest, payloadHash } from '../../src/contracts/gates'
import type { GateCoverage, GateManifest } from '../../src/contracts/gates'
import { diagnoseGraph } from '../../src/contracts/graphs'
import type { ArchiveMail } from '../../src/contracts/mail-archive'
import { parseWorkflowCommand, sequenceParts } from '../../src/contracts/workflows'
import { handleGate } from '../../src/main/gates/handler'
import { MailArchiveService } from '../../src/main/mail/archive/service'
import type { ArchiveProvider } from '../../src/main/mail/archive/service'
import { ArchiveStore } from '../../src/main/mail/archive/store'
import { chooseGateItem, discardGateBatch } from '../../src/worker/workflows/gates'
import { closeGraphs, graphFixture } from './graph-fixture'
import type { Item } from './graph-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const roots: string[] = []
afterEach(() => { closeGraphs(); vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const keys = ['news-1', 'news-2', 'news-3']
const mail = (key: string, version = 'v1'): ArchiveMail => ({ id: key, version, folder: 'inbox', internetMessageId: `<${key}@example.test>`, sender: 'news@example.test', subject: `Newsletter ${key}`, receivedAt: '2026-09-29T05:00:00Z', url: 'https://outlook.office.com/mail/id/one' })
const approve = { key: 'batch', title: 'Newsletter batch', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: 'mail.kept' }

/**
 * The real engine, dispatcher, gate logic and archive service. The identity provider and the
 * mailbox are replaced: `grants` is what the owner decided, `moved` is what left the Inbox.
 */
function fixture() {
  const grants = new Map<string, { status: 'pending' | 'approved' | 'denied' | 'expired' | 'used', manifest: GateManifest, key: string }>()
  const mailbox = new Map(keys.map(key => [key, mail(key)])); const moved: string[] = []; const reports: unknown[] = []
  const root = mkdtempSync(join(tmpdir(), 'pods-gate-archive-')); roots.push(root)
  const archive = new MailArchiveService(new ArchiveStore(root))
  const provider: ArchiveProvider = { applicationId: randomUUID(), applicationHash: 'pinned', read: async id => mailbox.get(id) ?? null, move: async (item) => { moved.push(item.id); return { state: 'archived', receipt: { ...item, folder: 'archive', version: 'moved' } } } }
  const grant = (id: string) => { const found = grants.get(id); if (!found) throw new Error('Unknown grant'); return found }
  const f = graphFixture([approve], {
    gate: async (value) => {
      const body = value as { operation: string, manifest: GateManifest, grants?: { key: string, id: string }[] }
      const manifest = parseGateManifest(body.manifest)
      if (body.operation === 'create') return { id: manifest.id, url: `https://id.example.test/grant-approval?batch=${manifest.id}`, grants: manifest.items.map((item) => { const id = randomUUID(); grants.set(id, { status: 'pending', manifest, key: item.key }); return { key: item.key, id } }) }
      for (const named of body.grants!) {
        const stored = grant(named.id); const item = manifest.items.find(entry => entry.key === named.key)!
        if (stored.key !== named.key || JSON.stringify(gateItemCommand(stored.manifest, item)) !== JSON.stringify(gateItemCommand(manifest, item))) throw new Error('Approval grant differs from the reviewed item or Pod identity')
      }
      if (body.operation === 'status') return Object.fromEntries(body.grants!.map(named => [named.key, grant(named.id).status]))
      for (const named of body.grants!) { if (grant(named.id).status !== 'approved') throw new Error('Approval is not current'); grant(named.id).status = 'used' }
      return true
    },
    mailArchive: async (value, _signal, scope) => {
      const body = value as { operation: string, target: { mailbox: string }, gate: GateCoverage[] }
      const views = []
      for (const coverage of body.gate.map(parseGateCoverage)) {
        const assertActive = async () => { if (coverage.items.some(item => grants.get(item.grantId)?.status !== 'used') || coverage.manifest.expiresAt <= Date.now()) throw new Error('Consumed approval is no longer valid') }
        views.push(await archive.processCovered(scope.podId, { id: coverage.manifest.id, grantId: coverage.grantId, expiresAt: coverage.manifest.expiresAt, mailbox: body.target.mailbox, items: coverage.items.map(item => ({ id: String(item.data.id), version: String(item.data.version), reason: 'Newsletter' })) }, provider, assertActive))
      }
      return views
    },
  })
  const received: Record<string, Item[][]> = { archive: [], keeper: [] }
  const source = f.pod('Source', { takes: [], gives: ['mail.newsletter'], summary: 'Reads mail' }, async (_items, emit) => { for (const key of keys) await emit('mail.newsletter', { key, data: { id: key, version: 'v1', subject: `Newsletter ${key}`, sender: 'news@example.test' } }) })
  const archiver = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }, async (items, _emit, _variables, request) => {
    received.archive!.push(items)
    reports.push(await request('mail.archive', { operation: 'process', target: { application: 'pods-mail', mailbox: 'owner@example.test' } }))
  })
  const keeper = f.pod('Keeper', { takes: ['mail.kept'], gives: [], summary: 'Keeps mail' }, async (items) => { received.keeper!.push(items) })
  f.save([source, archiver, keeper], ['mail.newsletter', 'mail.approved', 'mail.kept'])
  const batches = () => f.engine.view().gates!.batches
  const decide = (status: 'approved' | 'denied' | 'expired', only?: string[]) => { for (const item of grants.values()) { if (item.status === 'pending' && (!only || only.includes(item.key))) item.status = status } }
  /** A second run in which the source finds nothing new. */
  const again = () => { f.behaviours.set(source, async () => {}); return f.run() }
  return { ...f, grants, mailbox, moved, reports, received, source, archiver, keeper, batches, decide, again }
}

describe('refusals: nothing moves', () => {
  it('moves nothing while the owner has not decided', async () => {
    const f = fixture()
    await f.run(); await f.again(); await f.again()
    expect(f.moved).toEqual([])
    expect(f.received.archive).toEqual([[], [], []])
    expect(f.reports).toEqual([[], [], []])
    expect(f.batches()).toMatchObject([{ state: 'pending', gate: 'batch', podId: f.archiver, items: keys.map(key => ({ key, excluded: false })) }])
    expect(f.grants.size).toBe(keys.length)
    expect(f.trace('news-1').map(event => event.outcome)).toEqual(['emitted', 'held'])
    expect(f.pending('gate:batch')).toEqual(keys)
  })
  it('moves nothing after the batch expired and says so in the trace', async () => {
    const f = fixture()
    await f.run()
    f.decide('approved')
    f.store.db.prepare('UPDATE graph_gate_batches SET expires_at=?').run(Date.now() - 1)
    await f.again(); await f.again()
    expect(f.moved).toEqual([])
    expect(f.received.archive.flat()).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'expired' }])
    expect(Array.from(f.grants.values(), grant => grant.status)).toEqual(keys.map(() => 'approved'))
    expect(f.trace('news-1').at(-1)).toMatchObject({ node: 'gate:batch', outcome: 'expired' })
    expect(f.pending('gate:batch')).toEqual([])
  })
  it('moves nothing when the identity provider reports the grant as expired', async () => {
    const f = fixture()
    await f.run(); f.decide('expired'); await f.again()
    expect(f.moved).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'expired' }])
  })
  it('moves nothing after the owner refused and says so in the trace', async () => {
    const f = fixture()
    await f.run(); f.decide('denied'); await f.again(); await f.again()
    expect(f.moved).toEqual([])
    expect(f.received.archive.flat()).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'denied' }])
    expect(f.trace('news-2').find(event => event.node === 'gate:batch' && event.outcome === 'refused')).toBeDefined()
    expect(f.received.keeper.flat().map(item => item.key)).toEqual(keys)
  })
  it('moves nothing when every message changed since the batch was frozen and reports why', async () => {
    const f = fixture()
    await f.run()
    for (const key of keys) f.mailbox.set(key, mail(key, 'v2'))
    f.decide('approved'); await f.again()
    expect(f.moved).toEqual([])
    expect(f.reports.at(-1)).toMatchObject([{ state: 'completed', count: 0, outcomes: keys.map(id => ({ id, state: 'skipped', reason: 'Message changed or is no longer in the Inbox' })) }])
  })
  it('moves nothing when the consumed grant is no longer valid at the moment of the move', async () => {
    const f = fixture()
    await f.run(); f.decide('approved')
    f.behaviours.set(f.archiver, async (items, _emit, _variables, request) => {
      f.received.archive!.push(items)
      for (const grant of f.grants.values()) grant.status = 'denied'
      await request('mail.archive', { operation: 'process', target: { application: 'pods-mail', mailbox: 'owner@example.test' } })
    })
    expect((await f.again()).state).toBe('blocked')
    expect(f.received.archive.at(-1)).toHaveLength(3)
    expect(f.moved).toEqual([])
  })
  it('moves nothing when the grant was approved for another batch', async () => {
    const f = fixture()
    await f.run()
    f.store.db.prepare('UPDATE graph_gate_batches SET expires_at=expires_at+1').run()
    f.decide('approved'); await f.again()
    expect(f.moved).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'unknown', error: 'Approval grant differs from the reviewed item or Pod identity' }])
    expect(f.received.archive.flat()).toEqual([])
  })
  it('moves nothing when consuming the grant fails, blocks the gate and lets the owner discard the batch', async () => {
    const f = fixture()
    await f.run(); f.decide('approved')
    const grant = [...f.grants.values()][0]!
    Object.defineProperty(grant, 'status', { get: () => 'approved', set: () => { throw new Error('Identity provider failed') } })
    await f.again(); await f.again()
    expect(f.moved).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'unknown', error: 'Identity provider failed' }])
    expect(f.grants.size).toBe(keys.length)
    discardGateBatch(f.store, f.batches()[0]!.id, Date.now())
    expect(f.batches()).toMatchObject([{ state: 'denied', error: 'Discarded after review' }])
    expect(f.trace('news-1').at(-1)).toMatchObject({ outcome: 'refused', reason: 'Discarded after review' })
    expect(f.pending('gate:batch')).toEqual([])
  })
  it('refuses an archive proposal of its own and an item that the batch does not cover', async () => {
    const f = fixture(); let refusal = ''
    f.behaviours.set(f.archiver, async (_items, _emit, _variables, request) => {
      try { await request('mail.archive', { operation: 'prepare', proposal: { application: 'pods-mail', mailbox: 'owner@example.test', items: [{ id: 'news-1', version: 'v1', reason: 'Mine' }] } }) }
      catch (error) { refusal = (error as Error).message }
    })
    await f.run()
    expect(refusal).toBe('Channel graphs archive only through an approval gate')
    expect(f.moved).toEqual([])
    const items = [{ key: 'news-1', hash: payloadHash({ id: 'news-1', version: 'v1' }), title: 'One' }]
    const manifest: GateManifest = { version: 1, id: randomUUID(), workflowId: randomUUID(), gate: 'batch', title: 'Batch', podId: randomUUID(), expiresAt: 1, digest: gateDigest(items), items }
    expect(() => parseGateCoverage({ manifest, grantId: 'grant', items: [{ key: 'news-1', grantId: 'grant-1', data: { id: 'news-9', version: 'v1' } }] })).toThrow('Item is not part of the approved batch')
    expect(() => parseGateCoverage({ manifest, grantId: 'grant', items: [{ key: 'news-1', data: { id: 'news-1', version: 'v1' } }] })).toThrow('Invalid gate coverage')
    expect(() => parseGateManifest({ ...manifest, items: [...items, { key: 'news-2', hash: items[0]!.hash, title: 'Two' }] })).toThrow('does not match its digest')
  })
})

describe('approval', () => {
  it('moves exactly the three approved messages, once', async () => {
    const f = fixture()
    await f.run(); f.decide('approved'); await f.again(); await f.again()
    expect(f.moved).toEqual(keys)
    expect(f.received.archive.map(items => items.map(item => item.key))).toEqual([[], keys])
    expect(f.batches()).toMatchObject([{ state: 'approved' }])
    expect(Array.from(f.grants.values(), grant => grant.status)).toEqual(keys.map(() => 'used'))
    expect(f.trace('news-1').map(event => `${event.node === f.archiver ? 'archive' : event.node === f.source ? 'source' : event.node}:${event.outcome}`)).toEqual(['source:emitted', 'gate:batch:held', 'gate:batch:approved', 'archive:consumed'])
  })
  it('moves only the unchanged message of an approved batch', async () => {
    const f = fixture()
    await f.run(); f.mailbox.set('news-2', mail('news-2', 'v2')); f.mailbox.delete('news-3')
    f.decide('approved'); await f.again()
    expect(f.moved).toEqual(['news-1'])
  })
  it('moves only the approved messages and hands a denied one to the excluded channel', async () => {
    const f = fixture()
    await f.run()
    f.decide('denied', ['news-2']); f.decide('approved')
    await f.again(); await f.again()
    expect(f.moved).toEqual(['news-1', 'news-3'])
    expect(f.received.keeper.flat().map(item => item.key)).toEqual(['news-2'])
    expect(f.batches()).toMatchObject([{ state: 'approved' }])
    expect(Array.from(f.grants.values(), grant => `${grant.key}:${grant.status}`)).toEqual(['news-1:used', 'news-2:denied', 'news-3:used'])
    expect(f.trace('news-2').map(event => event.outcome)).toEqual(['emitted', 'held', 'refused', 'consumed'])
  })
  it('keeps the batch waiting until every item is decided', async () => {
    const f = fixture()
    await f.run(); f.decide('approved', ['news-1']); await f.again()
    expect(f.moved).toEqual([])
    expect(f.batches()).toMatchObject([{ state: 'pending' }])
  })
  it('returns the items of a batch with one collective grant to a new per-item batch', async () => {
    const f = fixture()
    await f.run()
    const [first] = f.batches()
    const legacy = JSON.parse(f.store.db.prepare('SELECT items FROM graph_gate_batches WHERE id=?').get(first!.id)!.items as string).map(({ grantId: _grantId, ...entry }: { grantId?: string }) => entry)
    f.store.db.prepare('UPDATE graph_gate_batches SET items=? WHERE id=?').run(JSON.stringify(legacy), first!.id)
    await f.again()
    expect(f.batches().map(batch => batch.state).sort()).toEqual(['pending', 'superseded'])
    expect(f.grants.size).toBe(keys.length * 2)
    expect(f.moved).toEqual([])
  })
  it('keeps at most four batches of at most thirty items waiting', async () => {
    const f = fixture()
    f.behaviours.set(f.source, async (_items, emit) => { for (let index = 0; index < 200; index++) await emit('mail.newsletter', { key: `bulk-${index}`, data: { id: `bulk-${index}`, version: 'v1' } }) })
    await f.run()
    for (let round = 0; round < 6; round++) await f.again()
    expect(f.batches().map(batch => batch.items.length)).toEqual([30, 30, 30, 30])
    expect(f.pending('gate:batch')).toHaveLength(200)
  })
})

describe('choose gate', () => {
  it('sends a held item to the channel of the option the owner picked', async () => {
    const review = { key: 'review', title: 'Review', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep', channel: 'mail.kept' }, { key: 'drop', title: 'Newsletter', channel: 'mail.newsletter' }] }
    const f = graphFixture([review]); const kept: string[] = []
    const source = f.pod('Source', { takes: [], gives: ['mail.unsure'], summary: 'Reads mail' }, async (_items, emit) => { await emit('mail.unsure', { key: 'mail-1', data: { subject: 'Offer' } }) })
    const keeper = f.pod('Keeper', { takes: ['mail.kept'], gives: [], summary: 'Keeps mail' }, async (items) => { kept.push(...items.map(item => item.key)) })
    const sink = f.pod('Sink', { takes: ['mail.newsletter'], gives: [], summary: 'Files mail' }, async () => {})
    f.save([source, keeper, sink], ['mail.unsure', 'mail.kept', 'mail.newsletter'])
    await f.run()
    const [held] = f.engine.view().gates!.held
    expect(held).toMatchObject({ gate: 'review', key: 'mail-1', title: 'Offer' })
    expect(() => chooseGateItem(f.store, f.id, 'review', held!.itemId, 'archive', Date.now())).toThrow('Gate option not found')
    chooseGateItem(f.store, f.id, 'review', held!.itemId, 'keep', Date.now())
    expect(() => chooseGateItem(f.store, f.id, 'review', held!.itemId, 'drop', Date.now())).toThrow('Item is not held by this gate')
    f.behaviours.set(source, async () => {})
    await f.run()
    expect(kept).toEqual(['mail-1'])
    expect(f.trace('mail-1').map(event => event.outcome)).toEqual(['emitted', 'chosen', 'consumed'])
    expect(f.engine.view().gates!.held).toEqual([])
  })
})

describe('contracts', () => {
  it('requires exactly one Pod behind an approval gate', () => {
    const [a, b] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
    const definition = { id: '00000000-0000-4000-8000-0000000000a0', revision: 1, name: 'Mail', nodes: [a, b].map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, paused: true, nextAt: null, ...sequenceParts, mode: 'channels' as const, channels: ['mail.newsletter', 'mail.approved'].map(name => ({ name, title: name, fields: [] })), gates: [{ ...approve, excluded: null }] as never }
    const source = { takes: [], gives: ['mail.newsletter'], summary: 'Reads mail' }; const taker = { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }
    expect(diagnoseGraph(definition, { [a]: source, [b]: taker })).toEqual([])
    expect(diagnoseGraph({ ...definition, nodes: [...definition.nodes, { podId: '00000000-0000-4000-8000-000000000003', after: [], handoff: false }] }, { [a]: source, [b]: taker, '00000000-0000-4000-8000-000000000003': taker }).map(item => item.code)).toEqual(['gate-consumer'])
  })
  it('accepts the three owner decisions as commands and nothing that approves a gate', () => {
    const id = randomUUID()
    expect(() => parseWorkflowCommand({ type: 'gateExclude', batchId: id, itemIds: [id] })).toThrow('Unsupported workflow command')
    expect(parseWorkflowCommand({ type: 'gateChoose', id, gate: 'review', itemId: id, option: 'keep' })).toMatchObject({ type: 'gateChoose' })
    expect(parseWorkflowCommand({ type: 'gateDiscard', batchId: id })).toEqual({ type: 'gateDiscard', batchId: id })
    expect(() => parseWorkflowCommand({ type: 'gateApprove', batchId: id })).toThrow('Unsupported workflow command')
  })
  it('requests the grant as the consumer Pod with the existing once-grant fields only', async () => {
    const podId = randomUUID(); const items = [{ key: 'news-1', hash: payloadHash({ id: 'news-1' }), title: 'Newsletter' }]
    const manifest: GateManifest = { version: 1, id: randomUUID(), workflowId: randomUUID(), gate: 'batch', title: 'Newsletter batch', podId, expiresAt: Date.now() + 60000, digest: gateDigest(items), items }
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ id: 'grant-1' })); vi.stubGlobal('fetch', fetch)
    const connections = { podConnection: async () => ({ subject: 'agent@example.test', owner: 'owner@example.test', issuer: 'https://id.example.test', targetHost: `pods:${podId}`, keyId: 'key', accessToken: async () => 'synthetic-only' }) }
    const scope = { podId, runId: randomUUID(), epoch: 0, assignmentRevision: 1, capabilities: [] }
    const input = { scope, connections: connections as never, check: async () => {}, signal: new AbortController().signal }
    expect(await handleGate({ ...input, body: { operation: 'create', manifest } })).toEqual({ id: manifest.id, url: `https://id.example.test/grant-approval?requester=agent%40example.test&batch=${manifest.id}`, grants: [{ key: 'news-1', id: 'grant-1' }] })
    const request = JSON.parse(String(fetch.mock.calls[0]![1]!.body))
    expect(Object.keys(request).sort()).toEqual(['audience', 'batch', 'command', 'grant_type', 'permissions', 'reason', 'requester', 'summary', 'target_host', 'waits_until'])
    expect(request).toMatchObject({ requester: 'agent@example.test', audience: 'pods-graph-gate', grant_type: 'once', target_host: `pods:${podId}`, command: gateItemCommand(manifest, items[0]!), permissions: [`graph.gate:${manifest.id}`], summary: { text: 'Newsletter' }, batch: { id: manifest.id, title: 'Newsletter batch', size: 1 } })
    expect(JSON.parse(request.command[2])).toMatchObject({ digest: manifest.digest, count: 1, podId, item: { key: 'news-1' } })
    await expect(handleGate({ ...input, scope: { ...scope, podId: randomUUID() }, body: { operation: 'create', manifest } })).rejects.toThrow('Gate batch belongs to another Pod')
    const listed = { id: 'grant-1', status: 'approved', decided_by: 'owner@example.test', request: { requester: 'agent@example.test', target_host: `pods:${podId}`, audience: 'pods-graph-gate', grant_type: 'once', waits_until: Math.floor(manifest.expiresAt / 1000), command: gateItemCommand(manifest, items[0]!), summary: { text: request.summary.text } } }
    fetch.mockImplementation(async (url: unknown) => String(url).endsWith('/.well-known/openid-configuration') ? Response.json({ openape_grant_batch_supported: true }) : Response.json({ data: [listed] }))
    expect(await handleGate({ ...input, body: { operation: 'status', manifest, grants: [{ key: 'news-1', id: 'grant-1' }] } })).toEqual({ 'news-1': 'approved' })
    expect(String(fetch.mock.calls.at(-1)![0])).toBe(`https://id.example.test/api/grants?requester=agent%40example.test&batch=${manifest.id}&limit=100`)
    fetch.mockImplementation(async (url: unknown) => String(url).endsWith('/.well-known/openid-configuration') ? Response.json({ openape_grant_batch_supported: true }) : Response.json({ data: [{ ...listed, auto_approval_kind: 'standing' }] }))
    await expect(handleGate({ ...input, body: { operation: 'status', manifest, grants: [{ key: 'news-1', id: 'grant-1' }] } })).rejects.toThrow('manual owner decision')
    await expect(handleGate({ ...input, body: { operation: 'status', manifest, grants: [{ key: 'news-9', id: 'grant-1' }] } })).rejects.toThrow('Invalid approval grant identities')
  })
})
