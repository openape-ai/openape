// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { parseNetworkCommand, parseNetworkView } from '../../src/contracts/networks'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { closeNetworks, networkFixture } from './network-fixture'
import { parseMailRequest } from '../../src/main/mail/contract'
import { assignedMail } from '../../src/main/mail/assigned'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

function fixture() {
  const f = networkFixture()
  const source = f.pod('First timer', { takes: [], gives: ['input'], summary: 'First source' }, async () => {})
  const other = f.pod('Second timer', { takes: [], gives: ['input'], summary: 'Second source' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['input'], gives: [], summary: 'Consumer' }, async () => {})
  const members = [source, other].map(podId => ({ podId, source: { schedule: { kind: 'interval' as const, seconds: podId === source ? 60 : 120 } }, serialCase: false }))
  const draft = { name: 'Two independent timers', groupId: f.groupId, members: [...members, { podId: consumer, source: null, serialCase: true }], channels: [{ name: 'input', title: 'Input', schemaVersion: 1, schema: { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const } }] }
  return { ...f, source, other, consumer, draft }
}

it('reviews owner-scoped values once and applies them only to declaring members', () => {
  const f = fixture()
  for (const podId of [f.source, f.other]) {
    const row = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(podId)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,?,?,?)').run(row.definition_id!, 'mailbox', 'public', '"synthetic@example.invalid"')
  }
  const setup = parseNetworkView(f.engine.execute({ type: 'setup', groupId: f.groupId, podIds: [f.source, f.other, f.consumer] })).setup!
  expect(setup.members.find(member => member.podId === f.source)!.values[0]).toEqual({ name: 'mailbox', kind: 'public', origin: 'definition', value: 'synthetic@example.invalid' })
  const id = f.engine.execute({ type: 'create', draft: { ...f.draft, sharedValues: { mailbox: 'shared@example.invalid' } } }).createdId!
  const view = parseNetworkView(f.engine.execute({ type: 'detail', id, revision: 1 }))
  expect(view.networks[0]).toMatchObject({ state: 'paused', podIds: expect.arrayContaining([f.source, f.other, f.consumer]) })
  for (const member of view.details!.members.slice(0, 2)) expect(member.values[0]).toEqual({ name: 'mailbox', kind: 'public', origin: 'composition', value: 'shared@example.invalid' })
  expect(view.details!.members[2]!.values).toEqual([])
  expect(view.details!.definition.members.slice(0, 2).map(member => member.source!.schedule)).toEqual([{ kind: 'interval', seconds: 60 }, { kind: 'interval', seconds: 120 }])
  const foreign = new NetworkEngine(f.store, f.dispatcher, f.resources, '/unused', () => ({ ...f.owner, subject: 'another-owner' }))
  expect(() => foreign.execute({ type: 'detail', id, revision: 1 })).toThrow('owner')
  expect(() => foreign.execute({ type: 'setup', groupId: f.groupId, podIds: [f.source] })).toThrow('owner')
  expect(() => f.engine.execute({ type: 'records', id, revision: 1, collectionId: randomUUID(), after: null })).toThrow('not bound')
})

it('rejects undeclared shared configuration atomically and never exposes secret references', () => {
  const f = fixture()
  expect(() => f.engine.execute({ type: 'create', draft: { ...f.draft, sharedValues: { undeclared: 'no' } } })).toThrow('declared public')
  expect(f.engine.view().networks).toEqual([])
  const row = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(f.source)!
  const secretId = randomUUID()
  f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,?,?,?)').run(row.definition_id!, 'protected', 'secret-reference', JSON.stringify({ kind: 'secret-reference', id: secretId }))
  const setup = f.engine.execute({ type: 'setup', groupId: f.groupId, podIds: [f.source] }).setup!
  expect(setup.members[0]!.values[0]).toMatchObject({ kind: 'secret-reference', value: null })
  expect(JSON.stringify(setup)).not.toContain(secretId)
  expect(() => f.engine.execute({ type: 'create', draft: { ...f.draft, sharedValues: { protected: 'not-a-secret' } } })).toThrow('declared public')
  expect(f.engine.view().networks).toEqual([])
})

it('pages recorded activity by stable keys with bounded payloads and no read side effects', () => {
  const f = fixture(); const id = f.engine.execute({ type: 'create', draft: f.draft }).createdId!
  const insert = f.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,?)')
  for (let index = 0; index < 60; index++) insert.run(id, 'synthetic-receipt', JSON.stringify({ index, reason: '😀'.repeat(9000), stepToken: 'must-not-leak' }), Date.now())
  const first = parseNetworkView(f.engine.execute({ type: 'trace', id, revision: 1, before: null, caseId: null })).trace!
  expect(first.events).toHaveLength(50); expect(first.events[0]!.truncated).toBe(true)
  expect(first.events[0]!.body).toHaveLength(8192)
  expect(JSON.stringify(first)).not.toContain('must-not-leak')
  insert.run(id, 'later-receipt', '{}', Date.now())
  const second = parseNetworkView(f.engine.execute({ type: 'trace', id, revision: 1, before: first.before, caseId: null })).trace!
  expect(second.events).toHaveLength(11); expect(second.before).toBeNull()
  expect(second.events.every(event => event.id < first.before!)).toBe(true)
  expect(f.engine.execute({ type: 'trace', id, revision: 1, before: null, caseId: randomUUID() }).trace!.events).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_trace_events').get()!.n).toBe(62)
  expect(() => parseNetworkCommand({ type: 'trace', id, revision: 1, before: -1, caseId: null })).toThrow()
  expect(() => parseNetworkCommand({ type: 'trace', id, revision: 1, before: null, caseId: null, limit: 10000 })).toThrow()
})

it('rejects stale setup authority and ignores selection order in the review fingerprint', () => {
  const f = fixture(); const podIds = f.draft.members.map(member => member.podId)
  const setup = f.engine.execute({ type: 'setup', groupId: f.groupId, podIds }).setup!
  expect(f.engine.execute({ type: 'setup', groupId: f.groupId, podIds: [...podIds].reverse() }).setup!.fingerprint).toBe(setup.fingerprint)
  f.store.db.prepare('UPDATE pods SET revision=revision+1 WHERE id=?').run(f.source)
  expect(() => f.engine.execute({ type: 'create', draft: { ...f.draft, expectedSetup: setup.fingerprint } })).toThrow('review current values')
  expect(f.engine.view().networks).toEqual([])
})

it('finds accepted source and settlement receipts for one case without other cases', async () => {
  const f = fixture(); const id = f.engine.execute({ type: 'create', draft: f.draft }).createdId!
  const authority = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  await f.engine.invocations.finish(authority, 'completed', 'Two independent cases', null, [], ['one', 'two'].map(key => ({ channel: 'input', key, sourceItemId: key, sourceVersion: '1', payload: { subject: key } })))
  const caseId = f.store.db.prepare('SELECT case_id FROM network_case_sources WHERE source_item=?').get('one')!.case_id as string
  const trace = parseNetworkView(f.engine.execute({ type: 'trace', id, revision: 1, caseId, before: null })).trace!
  expect(trace.events.map(event => event.kind)).toEqual(['invocation-settled', 'event-accepted'])
  expect(trace.events.every(event => event.caseId === caseId)).toBe(true)
  expect(trace.events[0]!.body).toContain('Two independent cases')
  const foreign = new NetworkEngine(f.store, f.dispatcher, f.resources, '/unused', () => ({ ...f.owner, subject: 'another-owner' }))
  expect(() => foreign.execute({ type: 'trace', id, revision: 1, caseId, before: null })).toThrow('owner')
  expect(() => foreign.execute({ type: 'records', id, revision: 1, collectionId: randomUUID(), after: null })).toThrow('owner')
})

it('preserves admission diagnostics and keeps recovery readable when member configuration is invalid', () => {
  const f = fixture(); const id = f.engine.execute({ type: 'create', draft: f.draft }).createdId!
  f.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,?)').run(id, 'instance-attention', JSON.stringify({ podId: f.source, message: 'Network instance needs validation for its current resources', stepToken: 'private' }), Date.now())
  const trace = f.engine.execute({ type: 'trace', id, revision: 1, before: null, caseId: null }).trace!
  expect(trace.events[0]!.body).toContain('needs validation')
  expect(trace.events[0]!.body).not.toContain('private')
  f.store.db.prepare('INSERT INTO definition_config SELECT definition_id,definition_version,\'token\',\'secret-reference\',\'"plain"\' FROM instance_definition_bindings WHERE pod_id=?').run(f.source)
  const detail = parseNetworkView(f.engine.execute({ type: 'detail', id, revision: 1 })).details!
  expect(detail.members.find(member => member.podId === f.source)!.diagnostic).toContain('protected-store reference')
  expect(detail.members.find(member => member.podId === f.other)!.diagnostic).toBeUndefined()
  expect(detail.failures).toEqual([])
  expect(f.engine.execute({ type: 'pause', id, revision: 1 }).networks[0]!.state).toBe('paused')
})

it('refuses a shared value whose type differs from one declaring definition without creating partial state', () => {
  const f = fixture()
  for (const [podId, value] of [[f.source, '"text"'], [f.other, 'true']]) {
    const binding = f.store.db.prepare('SELECT definition_id FROM instance_definition_bindings WHERE pod_id=?').get(podId!)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,?,?,?)').run(binding.definition_id!, 'shared', 'public', value!)
  }
  expect(() => f.engine.execute({ type: 'create', draft: { ...f.draft, sharedValues: { shared: 'text' } } })).toThrow('types must match')
  expect(f.engine.view().networks).toEqual([])
})

it('lets source and consumer members read their own assigned mailbox and refuses mutating or foreign requests', async () => {
  let f!: ReturnType<typeof networkFixture>
  // Like the worker's mail service, each request is checked against the calling Pod's own assigned mailbox.
  const tool = vi.fn(async (body: unknown, _signal: AbortSignal, scope: { podId: string }) => {
    parseMailRequest(body, assignedMail(f.resources.list(scope.podId)).mail)
    return { messages: [] }
  })
  f = networkFixture({ tool })
  const request = (account: string) => ({ toolId: 'o365-mail', argv: ['o365-cli', 'pods', 'read', '--operation', 'messages', '--account', account, '--folder', 'inbox'] })
  const accounts = { source: 'source@example.invalid', consumer: 'consumer@example.invalid' }
  const reads: string[] = []
  const source = f.pod('Mailbox source', { takes: [], gives: ['input'], summary: 'Assigned source' }, async (_items, invoke) => {
    const argv = request(accounts.source).argv
    for (const changed of [argv.map(value => value === accounts.source ? accounts.consumer : value), argv.map(value => value === 'messages' ? 'send' : value), argv.map(value => value === 'inbox' ? 'unassigned' : value)]) await expect(invoke('tools.invoke', { toolId: 'o365-mail', argv: changed })).rejects.toThrow()
    for (let index = 0; index < 101; index++) await invoke('tools.invoke', request(accounts.source))
    reads.push('source')
  })
  const consumer = f.pod('Mailbox consumer', { takes: ['input'], gives: [], summary: 'Reads its own mailbox' }, async (_items, invoke) => {
    await expect(invoke('tools.invoke', request(accounts.source))).rejects.toThrow()
    await expect(invoke('tools.invoke', request(accounts.consumer))).resolves.toEqual({ messages: [] })
    reads.push('consumer')
  })
  for (const [podId, account] of [[source, accounts.source], [consumer, accounts.consumer]] as const) {
    const connectionId = randomUUID()
    f.resources.replaceMail(podId, [
      { kind: 'tool', name: 'Assigned mailbox', configuration: { capability: 'mail.read', account, folders: ['inbox'], attachments: false, connectionId, grants: {} } },
      { kind: 'connection', name: 'Microsoft', configuration: { provider: 'microsoft', connectionId, account } },
      { kind: 'connection', name: 'Pod identity', configuration: { provider: 'openape', identity: { connectionId: randomUUID(), podId, issuer: f.owner.issuer, owner: f.owner.subject, subject: `synthetic-${podId}`, keyId: 'synthetic-key' } } },
    ])
    const pod = f.store.getPod(podId)
    const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript!)!
    const manifest = JSON.parse(row.manifest as string); manifest.capabilities = ['mail.read']
    f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify(manifest), podId, pod.activeScript!)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, pod.activeScript!, pod.bindingRevision, f.resources.epoch(podId), '{}')
  }
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])
  const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual', true)!
  await f.engine.invocations.finish(authority, 'completed', 'Source', null, [], [{ channel: 'input', key: 'one', sourceItemId: 'one', sourceVersion: 'provider-v1', payload: { subject: 'Synthetic' } }])
  f.process(id, [source, consumer], [source, consumer], 2); f.engine.tick()
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE state=\'completed\' AND execution_kind=\'script\'').get()!.count).toBe(3)
  expect(reads.sort()).toEqual(['consumer', 'source'])
  expect(tool.mock.settledResults.filter(result => result.type === 'fulfilled')).toHaveLength(102)
  expect(f.engine.execute({ type: 'trace', id, revision: 1, before: null, caseId: null }).trace!.events.some(event => event.kind === 'recovery-boundary' && event.body.includes('tools.invoke'))).toBe(true)
  await f.engine.stop(); await f.dispatcher.stop()
})
