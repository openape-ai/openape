// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { afterEach, expect, it, vi } from 'vitest'
import type { NetworkGateManifest } from '../../src/contracts/network-gates'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { archiveNotStarted, assertArchiveMove } from '../../src/contracts/network-capabilities'
import { NonRetryableError } from '../../src/contracts/infrastructure'
import { archiveApproved, mailContentVersion } from '../../src/worker/scheduling/network-archive'
import { digest } from '../../src/worker/storage/database'
import { closeNetworks, networkFixture } from './network-fixture'
import { executeAgent } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
vi.mock('../../src/worker/agent/executor', () => ({ executeAgent: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

const mailbox = 'owner@example.invalid'
const mail = { id: 'message-1', changeKey: 'change-1', parentFolderId: 'inbox-folder', from: { emailAddress: { address: 'news@example.invalid' } }, toRecipients: [{ emailAddress: { address: mailbox } }], ccRecipients: [], subject: 'Weekly news', receivedDateTime: '2026-10-08T08:00:00Z', body: { content: 'Synthetic newsletter', contentType: 'text' }, hasAttachments: false }
const reply = (operation: 'read' | 'move', fields: Record<string, unknown>) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ protocol: 'pods-mail/v1', account: mailbox, operation, ...fields }) })

function archiveFixture(options: { agent?: boolean, current?: typeof mail, mails?: typeof mail[], move?: (message: string) => unknown, payload?: Record<string, string>, preview?: boolean, readFailure?: Error } = {}) {
  const approved = options.mails ?? [mail]; const current = options.mails ?? [options.current ?? mail]
  const moves: string[][] = []
  const decision = { state: 'approved' }
  const tool = vi.fn(async (body: unknown, _signal: AbortSignal, scope: { assertCurrent: () => void }) => {
    scope.assertCurrent()
    const argv = (body as { argv: string[] }).argv
    if (argv[1] !== 'read') throw new Error('Scripts and the port may only read through the tool service')
    if (options.readFailure) throw options.readFailure
    const message = argv[argv.indexOf('--message') + 1]
    return reply('read', { outcome: 'confirmed', items: [current.find(item => item.id === message) ?? mail] })
  })
  const mailMove = vi.fn(async (body: unknown) => {
    const argv = (body as { argv: string[] }).argv
    assertArchiveMove(argv); moves.push(argv)
    const message = argv[argv.indexOf('--message') + 1]!
    return options.move?.(message) ?? reply('move', { outcome: 'confirmed', beforeId: message, afterId: `archived-${message}`, requestId: `request-${message}`, receipt: { id: `archived-${message}`, parentFolderId: 'archive-folder' } })
  })
  const gateCapabilities: string[][] = []
  const f = networkFixture({ tool, mailMove, provider: async () => new Response('{}'), gate: async (value, _signal, scope) => {
    scope.assertCurrent()
    gateCapabilities.push(scope.capabilities)
    const body = value as { operation: string, manifest: NetworkGateManifest, grants?: { key: string, id: string }[] }
    f.engine.gates.authorizeService(scope, body.manifest, body.operation, body.grants)
    if (body.operation === 'create') return { id: body.manifest.id, url: 'https://identity.example.invalid/decision', grants: body.manifest.items.map(item => ({ key: item.deliveryId, id: `once-${item.deliveryId}` })) }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, decision.state]))
    return true
  } })
  const outcomes: unknown[] = []; const refusals: string[] = []
  const source = f.pod('Intake', { takes: [], gives: ['mail.batch'], summary: 'Reads mail' }, async (_items, invoke) => {
    if (options.readFailure) await invoke('tools.invoke', { application: 'mail', argv: ['workflow', 'read', '--account', mailbox, '--message', mail.id] })
    await invoke('network.archive', { application: 'mail', mailbox }).catch((error: Error) => refusals.push(error.message))
  })
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives approved mail' }, async (_items, invoke) => {
    await invoke('tools.invoke', { application: 'mail', argv: ['workflow', 'read', '--account', mailbox, '--message', mail.id] }).catch((error: Error) => refusals.push(error.message))
    if (options.agent) await invoke('agent.run', { prompt: 'Archive the approved newsletters', tools: ['ape_shell'] })
    outcomes.push(await invoke('network.archive', { application: 'mail', mailbox }))
  })
  const excluded = f.pod('Excluded', { takes: ['mail.excluded'], gives: [], summary: 'Keeps denied mail' }, async () => {})
  const assign = (podId = archive) => {
    const applicationId = randomUUID(); const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
    f.resources.assignProgram(podId, applicationId, { type: 'program', name: 'mail', capability } as ProgramAssignment, f.resources.epoch(podId))
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
  for (const podId of [...(options.preview ? [] : [archive]), ...(options.readFailure ? [source] : [])]) {
    const capability = assign(podId)
    const pod = f.store.getPod(podId)
    const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript!)!
    f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify({ ...JSON.parse(row.manifest as string), capabilities: [capability] }), podId, pod.activeScript!)
    f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, pod.activeScript!, pod.bindingRevision, f.resources.epoch(podId), '{}')
    // Assigning the application pauses the Pod, as for any rights change.
    f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(podId)
  }
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[archive, excluded].map(podId => ({ podId, source: null, serialCase: false }))], ['mail.batch', 'mail.approved', 'mail.excluded'], [{ key: 'newsletter', kind: 'approve', title: 'Archive newsletters', takes: 'mail.batch', gives: 'mail.approved', excluded: 'mail.excluded' }])
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const settle = async () => { await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0) }
  const rounds = async () => { for (let round = 0; round < 4 + approved.length; round++) { f.store.db.prepare('UPDATE network_gate_controls SET next_poll_at=0').run(); f.engine.tick(); await settle() } }
  const approve = async () => {
    const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
    await f.engine.invocations.finish(authority, 'completed', 'Synthetic intake', null, [], approved.map(item => ({ channel: 'mail.batch', key: item.id, sourceItemId: item.id, sourceVersion: mailContentVersion(item), payload: options.payload ?? { subject: item.subject } })))
    await rounds()
  }
  const gates = () => f.store.db.prepare('SELECT state FROM network_gate_tasks ORDER BY created_at,rowid').all().map(row => row.state)
  const deliveries = () => f.store.db.prepare('SELECT d.state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').all(archive).map(row => row.state)
  const effects = () => f.store.db.prepare('SELECT a.state, group_concat(r.outcome) AS receipts FROM network_effect_attempts a JOIN network_effect_receipts r ON r.logical_action_key=a.logical_action_key AND r.attempt=a.attempt GROUP BY a.logical_action_key,a.attempt').all()
  return { ...f, id, source, archive, tool, mailMove, moves, outcomes, refusals, approve, rounds, settle, effects, decision, assign, archiveScript, gates, deliveries, gateCapabilities }
}

it('moves an owner-approved message once into the Archive folder with a receipt', async () => {
  const f = archiveFixture()
  await f.approve()
  expect(f.outcomes).toEqual([[expect.objectContaining({ messageId: mail.id, outcome: 'archived', reason: 'Moved to the Archive folder' })]])
  expect(f.moves).toEqual([['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']])
  expect(f.effects()).toEqual([{ state: 'confirmed_applied', receipts: 'intent,confirmed_applied' }])
  expect(f.refusals).toEqual([expect.stringContaining('declared source')])
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(f.archive)!.state).toBe('completed')
  // Run services compare the gate step scope with the pinned consumer script, which holds the mail application.
  expect(f.gateCapabilities).toEqual(expect.arrayContaining([[expect.stringMatching(/^tool\.app_[a-f0-9]{32}\.invoke$/)]]))
  expect(f.gateCapabilities.every(item => item.length === 1)).toBe(true)
})

it('refuses mail application calls of an agent in an archive consumer; only the approved port moves mail', async () => {
  const agentRefusals: string[] = []
  vi.mocked(executeAgent).mockImplementation(async (_runtime, _directory, _prompt, _references, services, signal) => {
    for (const argv of [['workflow', 'read', '--account', mailbox, '--message', mail.id], ['workflow', 'move', '--account', mailbox, '--message', mail.id, '--destination', 'archive']]) await services.tool!({ application: 'mail', argv }, signal).catch((error: Error) => agentRefusals.push(error.message))
    return { threadId: 'synthetic', response: 'done' }
  })
  const f = archiveFixture({ agent: true })
  await f.approve()
  expect(executeAgent).toHaveBeenCalledTimes(1)
  expect(agentRefusals).toEqual([expect.stringContaining('declared source'), expect.stringContaining('declared source')])
  expect(f.tool.mock.calls.filter(([body]) => (body as { argv: string[] }).argv[1] === 'move')).toEqual([])
  expect(f.moves).toEqual([['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']])
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

const unbound = (message: string) => reply('move', { outcome: 'confirmed', beforeId: message, afterId: `archived-${message}`, requestId: `request-${message}`, receipt: { id: `archived-${message}`, parentFolderId: mail.parentFolderId } })
const second = { ...mail, id: 'message-2', changeKey: 'change-2', subject: 'Monthly news' }
const third = { ...mail, id: 'message-3', changeKey: 'change-3', subject: 'Product news' }

it('holds back only the mail with an unknown move and keeps archiving the others', async () => {
  const f = archiveFixture({ mails: [mail, second], move: message => message === mail.id ? unbound(message) : undefined })
  await f.approve()
  expect(f.moves.map(argv => argv[5]).sort()).toEqual([mail.id, second.id])
  expect(f.outcomes.flat()).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: mail.id, outcome: 'unknown' }), expect.objectContaining({ messageId: second.id, outcome: 'archived' })]))
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\' ORDER BY rowid').all(f.archive).map(row => row.state)).toEqual(['completed', 'completed'])
  expect(f.deliveries().sort()).toEqual(['done', 'unknown'])
  const held = f.engine.execute({ type: 'detail', id: f.id, revision: 1 }).details!.failures.find(failure => failure.kind === 'uncertain')!
  expect(held.effects).toEqual([expect.objectContaining({ state: 'unknown', sequence: 2 })])

  const effect = held.effects[0]!
  await f.engine.recover({ type: 'reconcileEffect', id: f.id, revision: 1, runId: held.runId, generation: held.generation, key: effect.key, attempt: effect.attempt, sequence: effect.sequence, outcome: 'confirmed_applied', evidence: 'Synthetic provider evidence: the message is in the Archive folder' })

  expect(f.deliveries()).toEqual(['done', 'done'])
  expect(f.engine.execute({ type: 'detail', id: f.id, revision: 1 }).details!.failures).toEqual([])
  expect(f.moves).toHaveLength(2)
  f.store.assertStorage()
})

it('stops the member after a second unresolved unknown move', async () => {
  const f = archiveFixture({ mails: [mail, second, third], move: unbound })
  await f.approve()
  expect(f.moves).toHaveLength(2)
  expect(f.deliveries().sort()).toEqual(['pending', 'unknown', 'unknown'])
  expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'instance-attention\' ORDER BY id DESC').get()!.body).toContain('Network member stopped after repeated unknown external outcomes')
})

it('never moves a message again while an earlier attempt of another version is unresolved', async () => {
  const f = archiveFixture({ move: unbound })
  await f.approve()
  const run = f.store.db.prepare('SELECT run_id,network_id FROM network_invocations WHERE pod_id=? AND execution_kind=\'script\'').get(f.archive)!
  const delivery = f.store.db.prepare('SELECT d.id FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(f.archive)!
  f.store.db.prepare('UPDATE network_case_revisions SET source_mapping=json_set(source_mapping,\'$.sourceVersion\',\'content:changed\')').run()
  const coverage = [{ manifest: JSON.parse(f.store.db.prepare('SELECT manifest FROM network_gate_tasks').get()!.manifest as string), grantId: 'once', items: [{ deliveryId: delivery.id as string, eventId: randomUUID(), key: mail.id, grantId: 'once', data: {} }] }]
  const again = await archiveApproved(f.store, { networkId: run.network_id as string, runId: run.run_id as string, podId: f.archive, owner: f.owner }, coverage, { application: 'mail', mailbox }, { read: async () => { throw new Error('No read expected') }, move: async () => { throw new Error('No move expected') }, approved: async () => {} }, () => {})
  expect(again).toEqual([expect.objectContaining({ outcome: 'skipped', reason: 'An earlier archive attempt of this message awaits reconciliation' })])
  expect(f.moves).toHaveLength(1)
})

it('does not retry a run whose tool output exceeded its limit', async () => {
  const f = archiveFixture({ readFailure: new NonRetryableError('Tool output exceeded 200000 bytes; read smaller pages, for example with --limit') })
  f.process(f.id, [f.source], [], 1); await f.settle()
  expect(f.store.db.prepare('SELECT i.state,c.retry_at,c.failure_kind,c.diagnostic FROM network_invocations i JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.pod_id=?').all(f.source))
    .toEqual([{ state: 'blocked', retry_at: null, failure_kind: 'exhausted', diagnostic: expect.stringContaining('Tool output exceeded 200000 bytes') }])
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

it('asks the identity provider again for an obsolete batch with the owner evidence', async () => {
  const g = archiveFixture({ preview: true })
  g.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(g.archive)
  await g.approve()
  const task = g.store.db.prepare('SELECT * FROM network_gate_tasks').get()!
  const legacy = g.engine.gates as unknown as { obsolete: (task: unknown, failure: Error) => void }
  g.store.transaction(() => legacy.obsolete(task, new Error('Network gate consumer or definition authority changed')))
  const current = g.store.db.prepare('SELECT generation FROM network_gate_tasks WHERE id=?').get(task.id as string)!
  g.engine.execute({ type: 'gateReview', id: g.id, revision: 1, taskId: task.id as string, generation: Number(current.generation), evidence: 'Blocked by an earlier release' })
  expect(g.deliveries()).toEqual(['pending'])
  expect(JSON.parse(g.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'gate-owner-fresh-approval\'').get()!.body as string).receipt.ownerEvidence).toBe('Blocked by an earlier release')
})
