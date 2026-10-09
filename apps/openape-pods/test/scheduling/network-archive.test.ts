// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { afterEach, expect, it, vi } from 'vitest'
import type { NetworkGateManifest } from '../../src/contracts/network-gates'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { archiveNotStarted, assertArchiveMove } from '../../src/contracts/network-capabilities'
import { archiveApproved, mailContentVersion } from '../../src/worker/scheduling/network-archive'
import { digest } from '../../src/worker/storage/database'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

const mailbox = 'owner@example.invalid'
const mail = { id: 'message-1', changeKey: 'change-1', parentFolderId: 'inbox-folder', from: { emailAddress: { address: 'news@example.invalid' } }, toRecipients: [{ emailAddress: { address: mailbox } }], ccRecipients: [], subject: 'Weekly news', receivedDateTime: '2026-10-08T08:00:00Z', body: { content: 'Synthetic newsletter', contentType: 'text' }, hasAttachments: false }
const reply = (operation: 'read' | 'move', fields: Record<string, unknown>) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ protocol: 'pods-mail/v1', account: mailbox, operation, ...fields }) })

function archiveFixture(options: { current?: typeof mail, move?: () => unknown, payload?: Record<string, string>, preview?: boolean } = {}) {
  const moves: string[][] = []
  const decision = { state: 'approved' }
  const tool = vi.fn(async (body: unknown, _signal: AbortSignal, scope: { assertCurrent: () => void }) => {
    scope.assertCurrent()
    const argv = (body as { argv: string[] }).argv
    if (argv[1] !== 'read') throw new Error('Scripts and the port may only read through the tool service')
    return reply('read', { outcome: 'confirmed', items: [options.current ?? mail] })
  })
  const mailMove = vi.fn(async (body: unknown) => {
    const argv = (body as { argv: string[] }).argv
    assertArchiveMove(argv); moves.push(argv)
    return options.move?.() ?? reply('move', { outcome: 'confirmed', beforeId: mail.id, afterId: 'archived-1', requestId: 'request-1', receipt: { id: 'archived-1', parentFolderId: 'archive-folder' } })
  })
  const f = networkFixture({ tool, mailMove, gate: async (value, _signal, scope) => {
    scope.assertCurrent()
    const body = value as { operation: string, manifest: NetworkGateManifest, grants?: { key: string, id: string }[] }
    f.engine.gates.authorizeService(scope, body.manifest, body.operation, body.grants)
    if (body.operation === 'create') return { id: body.manifest.id, url: 'https://identity.example.invalid/decision', grants: body.manifest.items.map(item => ({ key: item.deliveryId, id: `once-${item.deliveryId}` })) }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, decision.state]))
    return true
  } })
  const outcomes: unknown[] = []; const refusals: string[] = []
  const source = f.pod('Intake', { takes: [], gives: ['mail.batch'], summary: 'Reads mail' }, async (_items, invoke) => {
    await invoke('network.archive', { application: 'mail', mailbox }).catch((error: Error) => refusals.push(error.message))
  })
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives approved mail' }, async (_items, invoke) => {
    await invoke('tools.invoke', { application: 'mail', argv: ['workflow', 'read', '--account', mailbox, '--message', mail.id] }).catch((error: Error) => refusals.push(error.message))
    outcomes.push(await invoke('network.archive', { application: 'mail', mailbox }))
  })
  const excluded = f.pod('Excluded', { takes: ['mail.excluded'], gives: [], summary: 'Keeps denied mail' }, async () => {})
  const assign = () => {
    const applicationId = randomUUID(); const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
    f.resources.assignProgram(archive, applicationId, { type: 'program', name: 'mail', capability } as ProgramAssignment, f.resources.epoch(archive))
    return capability
  }
  // Stores and validates a member script version with the archive capability, as validation would.
  const archiveScript = (capability: string, marker: string) => {
    const pod = f.store.getPod(archive)
    const manifest = JSON.parse(f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(archive, pod.activeScript!)!.manifest as string)
    const code = `export const contract=${JSON.stringify(manifest.contract)};\n// ${marker}\nexport async function run() {}\n`
    const hash = digest(code)
    f.store.storeScript(archive, { ...manifest, capabilities: [capability], contentHash: hash }, code)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(archive, hash, pod.bindingRevision, f.resources.epoch(archive), '{}')
    return hash
  }
  if (!options.preview) {
    const capability = assign()
    const pod = f.store.getPod(archive)
    const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(archive, pod.activeScript!)!
    f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify({ ...JSON.parse(row.manifest as string), capabilities: [capability] }), archive, pod.activeScript!)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(archive, pod.activeScript!, pod.bindingRevision, f.resources.epoch(archive), '{}')
    // Assigning the application pauses the Pod, as for any rights change.
    f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(archive)
  }
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[archive, excluded].map(podId => ({ podId, source: null, serialCase: false }))], ['mail.batch', 'mail.approved', 'mail.excluded'], [{ key: 'newsletter', kind: 'approve', title: 'Archive newsletters', podId: archive, channel: 'mail.batch' }], [{ key: 'newsletter', kind: 'approve', title: 'Archive newsletters', takes: 'mail.batch', gives: 'mail.approved', excluded: 'mail.excluded' }])
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const settle = async () => { await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0) }
  const rounds = async () => { for (let round = 0; round < 4; round++) { f.store.db.prepare('UPDATE network_gate_controls SET next_poll_at=0').run(); f.engine.tick(); await settle() } }
  const approve = async () => {
    const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
    await f.engine.invocations.finish(authority, 'completed', 'Synthetic intake', null, [], [{ channel: 'mail.batch', key: 'message-1', sourceItemId: mail.id, sourceVersion: mailContentVersion(mail), payload: options.payload ?? { subject: mail.subject } }])
    await rounds()
  }
  const gates = () => f.store.db.prepare('SELECT state FROM network_gate_tasks ORDER BY created_at,rowid').all().map(row => row.state)
  const deliveries = () => f.store.db.prepare('SELECT d.state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').all(archive).map(row => row.state)
  const effects = () => f.store.db.prepare('SELECT a.state, group_concat(r.outcome) AS receipts FROM network_effect_attempts a JOIN network_effect_receipts r ON r.logical_action_key=a.logical_action_key AND r.attempt=a.attempt GROUP BY a.logical_action_key,a.attempt').all()
  return { ...f, id, source, archive, tool, mailMove, moves, outcomes, refusals, approve, rounds, settle, effects, decision, assign, archiveScript, gates, deliveries }
}

it('moves an owner-approved message once into the Archive folder with a receipt', async () => {
  const f = archiveFixture()
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ messageId: mail.id, outcome: 'archived', reason: 'Moved to the Archive folder' })]])
  expect(f.moves).toEqual([['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']])
  expect(f.effects()).toEqual([{ state: 'confirmed_applied', receipts: 'intent,confirmed_applied' }])
  expect(f.refusals).toEqual([expect.stringContaining('declared source')])
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(f.archive)!.state).toBe('completed')
})

it('never moves a message twice for the same approved version', async () => {
  const f = archiveFixture()
  await f.approve()
  const run = f.store.db.prepare('SELECT run_id,network_id FROM network_invocations WHERE pod_id=?').get(f.archive)!
  const delivery = f.store.db.prepare('SELECT d.id FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.archive)!
  const coverage = [{ manifest: JSON.parse(f.store.db.prepare('SELECT manifest FROM network_gate_tasks').get()!.manifest as string), grantId: 'once', items: [{ deliveryId: delivery.id as string, eventId: randomUUID(), key: 'message-1', grantId: 'once', data: {} }] }]
  const again = await archiveApproved(f.store, { networkId: run.network_id as string, runId: run.run_id as string, podId: f.archive, owner: f.owner }, coverage, { application: 'mail', mailbox }, { read: async () => { throw new Error('No read expected') }, move: async () => { throw new Error('No move expected') }, approved: async () => {} }, () => {})
  expect(again).toEqual([expect.objectContaining({ outcome: 'archived', reason: 'Already archived' })])
  expect(f.moves).toHaveLength(1)
})

it('leaves a message in place when its content changed after approval', async () => {
  const f = archiveFixture({ current: { ...mail, body: { content: 'Changed body', contentType: 'text' } } })
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ outcome: 'skipped', reason: 'Message changed after approval; it stays in place' })]])
  expect(f.moves).toEqual([])
  expect(f.effects()).toEqual([{ state: 'confirmed_not_applied', receipts: 'intent,confirmed_not_applied' }])
})

it('keeps an unbound move receipt unknown and blocks the member until reconciliation', async () => {
  const f = archiveFixture({ move: () => reply('move', { outcome: 'confirmed', beforeId: mail.id, afterId: 'archived-1', requestId: 'request-1', receipt: { id: 'archived-1', parentFolderId: mail.parentFolderId } }) })
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ outcome: 'unknown' })]])
  expect(f.effects()).toEqual([{ state: 'unknown', receipts: 'intent,unknown' }])
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(f.archive)!.state).toBe('unknown')
})

it('records a broker refusal before sending as not applied and keeps the member usable', async () => {
  const f = archiveFixture({ move: () => { throw new Error(`${archiveNotStarted}: Approve this application command in Permissions first`) } })
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ outcome: 'skipped', reason: expect.stringContaining('Approve this application command') })]])
  expect(f.effects()).toEqual([{ state: 'confirmed_not_applied', receipts: 'intent,confirmed_not_applied' }])
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(f.archive)!.state).toBe('completed')
})

it('does not move a message whose provider subject differs from the approved item', async () => {
  const f = archiveFixture({ payload: { subject: 'Invoice 4711' } })
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ outcome: 'skipped', reason: 'Message does not match the approved sender and subject' })]])
  expect(f.moves).toEqual([])
})

it('refuses the port for a source member', async () => {
  const f = archiveFixture()
  f.process(f.id, [f.source], [], 1); await f.settle()
  expect(f.refusals).toEqual([expect.stringContaining('Only a member behind an approval gate')])
  expect(f.mailMove).not.toHaveBeenCalled()
})

it('accepts only the exact move into the Archive folder', () => {
  expect(() => assertArchiveMove(['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', 'v', '--source-folder', 'f', '--destination', 'deleteditems'])).toThrow('Archive folder')
  expect(() => assertArchiveMove(['mail', 'trash', '--account', mailbox])).toThrow('Archive folder')
  expect(() => assertArchiveMove(['workflow', 'move', '--account', mailbox, '--message', '--expected-version', 'v', 'x', '--source-folder', 'f', '--destination', 'archive'])).toThrow('Archive folder')
})

it('resolves the archive adapter only to the granted read and move operations', async () => {
  const adapter = loadAdapter('o365-cli', resolve('examples/network-mail-archive-shapes.toml'))
  const move = ['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', 'change-1', '--source-folder', 'inbox-folder', '--destination', 'archive']
  assertArchiveMove(move)
  expect((await resolveCommand(adapter, ['o365-cli', ...move])).detail).toMatchObject({ action: 'move' })
  expect((await resolveCommand(adapter, ['o365-cli', 'workflow', 'read', '--account', mailbox, '--message', mail.id])).detail).toMatchObject({ action: 'read' })
  expect((await resolveCommand(adapter, ['o365-cli', 'auth', 'login', '--account', mailbox])).detail).toMatchObject({ action: 'login' })
  await expect(resolveCommand(adapter, ['o365-cli', 'mail', 'trash', '--account', mailbox, '--message', mail.id])).rejects.toThrow()
})

it('asks again for an undecided approval when the consumer rights change', async () => {
  const f = archiveFixture()
  f.decision.state = 'pending'
  await f.approve()
  expect(f.gates()).toEqual(['pending'])

  f.assign()
  await f.rounds()

  // Assigning the application paused the Pod, so the fresh batch waits before it asks the identity provider.
  expect(f.gates()).toEqual(['superseded', 'preparing'])
  expect(f.deliveries()).toEqual(['pending'])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'gate-fresh-approval\'').get()!.count).toBe(1)
  f.store.assertStorage()
})

it('turns a paused preview member into the archive member and asks again for its approvals', async () => {
  const f = archiveFixture({ preview: true })
  f.decision.state = 'pending'
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.archive)
  await f.approve()
  expect(f.gates()).toEqual(['preparing'])
  const capability = f.assign()
  const hash = f.archiveScript(capability, 'archive')
  f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(f.archive)
  expect(() => f.engine.updateMemberScript({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.archive, hash })).toThrow('Rights changes require pausing the member first')
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.archive)

  f.engine.updateMemberScript({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.archive, hash })

  expect(f.gates()).toEqual(['superseded'])
  expect(f.deliveries()).toEqual(['pending'])
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'member-script-updated\'').get()!.body as string)).toMatchObject({ script: hash, rightsChanged: true, renewedApprovals: 1 })
  f.decision.state = 'approved'
  f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(f.archive)
  await f.rounds()
  expect(f.gates()).toEqual(['superseded', 'approved'])
  expect(f.moves).toHaveLength(1)
  f.store.assertStorage()
})

it('returns inputs an earlier release blocked as obsolete to a fresh approval when the paused member is updated', async () => {
  const f = archiveFixture({ preview: true })
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.archive)
  await f.approve()
  const task = f.store.db.prepare('SELECT * FROM network_gate_tasks').get()!
  // Releases before this fix blocked such inputs instead of asking again.
  const legacy = f.engine.gates as unknown as { obsolete: (task: unknown, failure: Error) => void }
  f.store.transaction(() => legacy.obsolete(task, new Error('Network gate consumer or definition authority changed')))
  expect(f.deliveries()).toEqual(['blocked'])
  const hash = f.archiveScript(f.assign(), 'archive')

  f.engine.updateMemberScript({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.archive, hash })

  expect(f.deliveries()).toEqual(['pending'])
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'member-script-updated\'').get()!.body as string)).toMatchObject({ rightsChanged: true, renewedApprovals: 1 })
  f.store.assertStorage()
})

it('never asks again for an input the owner refused', async () => {
  const f = archiveFixture({ preview: true })
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.archive)
  await f.approve()
  const task = f.store.db.prepare('SELECT * FROM network_gate_tasks').get()!
  const legacy = f.engine.gates as unknown as { obsolete: (task: unknown, failure: Error) => void }
  f.store.transaction(() => legacy.obsolete(task, new Error('Network gate consumer or definition authority changed')))
  f.store.db.prepare('UPDATE network_gate_items SET outcome=\'denied\'').run()
  const hash = f.archiveScript(f.assign(), 'archive')

  f.engine.updateMemberScript({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.archive, hash })

  expect(f.deliveries()).toEqual(['blocked'])
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'member-script-updated\'').get()!.body as string)).toMatchObject({ renewedApprovals: 0 })
})
