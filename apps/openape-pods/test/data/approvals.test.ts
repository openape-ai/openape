// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Approvals, programObject } from '../../src/worker/data/approvals'
import { describeProgram, invokeApproved } from '../../src/worker/runs/program-effects'
import type { ApprovalService } from '../../src/worker/data/approvals'
import { archiveApproved, mailContentVersion } from '../../src/worker/data/mail-archive'
import { approvalCommand } from '../../src/contracts/approvals'
import type { ApprovalManifest } from '../../src/contracts/approvals'
import { cleanup, workFixture } from './work-fixture'

afterEach(cleanup)
const owner = { issuer: 'https://id.example.invalid', subject: 'owner@example.invalid' }
const mailbox = 'owner@example.invalid'
const mail = { id: 'message-1', changeKey: 'change-1', parentFolderId: 'inbox-folder', from: { emailAddress: { address: 'news@example.invalid' } }, toRecipients: [{ emailAddress: { address: mailbox } }], ccRecipients: [], subject: 'Weekly news', receivedDateTime: '2026-10-08T08:00:00Z', body: { content: 'Synthetic newsletter', contentType: 'text' }, hasAttachments: false }
const reply = (operation: 'read' | 'move', fields: Record<string, unknown>) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ protocol: 'pods-mail/v1', account: mailbox, operation, ...fields }) })

/** An IdP double: records every operation and answers with the decision set for each grant. */
function idp() {
  const calls: { operation: string, keys: string[], commands: string[][] }[] = []
  const decisions = new Map<string, string>()
  let failCreate = false
  const service: ApprovalService = async (body) => {
    calls.push({ operation: body.operation, keys: (body.grants ?? body.manifest.items).map(item => 'key' in item ? item.key : ''), commands: body.manifest.items.map(item => approvalCommand(item.authority)) })
    if (body.operation === 'create') {
      if (failCreate) throw new Error('IdP connection reset')
      return { url: 'https://id.example.invalid/grant-approval?batch=1', grants: body.manifest.items.map(item => ({ key: item.key, id: `grant-${item.key}` })) }
    }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, decisions.get(grant.key) ?? 'pending']))
    return true
  }
  return { service, calls, decisions, failCreate: () => { failCreate = true } }
}

function fixture() {
  const f = workFixture()
  const pod = f.pod('Newsletter Review')
  const approvals = new Approvals(f.store, () => owner)
  approvals.collect = { quietMs: 0, maxMs: 0 }
  const run = f.run(pod)
  const ask = (version = mailContentVersion(mail), subject = mail.subject) => approvals.request(run, { action: 'mail.archive', object: `${mailbox}:${mail.id}`, title: 'Ignored script title', payload: { mailbox, messageId: mail.id, version, subject, sender: 'news@example.invalid' } })
  return { ...f, podId: pod, approvals, run, ask }
}

describe('object approvals at the IdP', () => {
  it('requests once, binds each grant to the exact object and payload, and uses an approval exactly once', async () => {
    const f = fixture(); const server = idp()
    const asked = f.ask()
    expect(f.ask().id).toBe(asked.id)
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    expect(server.calls.map(call => call.operation)).toEqual(['create', 'status'])
    const authority = JSON.parse(server.calls[0]!.commands[0]![2]!) as Record<string, unknown>
    expect(authority).toMatchObject({ version: 5, podId: f.podId, action: 'mail.archive', object: `${mailbox}:${mail.id}` })
    server.decisions.set(asked.id, 'approved')
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    expect(f.approvals.get(f.podId, asked.id).state).toBe('approved')
    await f.approvals.consume(f.podId, asked.id, server.service, new AbortController().signal)
    expect(f.approvals.get(f.podId, asked.id).state).toBe('consumed')
    await expect(f.approvals.consume(f.podId, asked.id, server.service, new AbortController().signal)).rejects.toThrow('consumed')
    expect(server.calls.filter(call => call.operation === 'consume')).toHaveLength(1)
    expect(f.approvals.releasable().map(item => item.grants)).toEqual([[{ key: asked.id, id: `grant-${asked.id}` }]])
  })

  it('keeps a denial final, withdraws an approval when the content changes and asks an unanswered expiry again', async () => {
    const f = fixture(); const server = idp()
    const first = f.ask()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    server.decisions.set(first.id, 'denied')
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    expect(f.approvals.get(f.podId, first.id).state).toBe('denied')
    expect(f.ask().state).toBe('denied')
    // Changed content: a new request; nothing approved earlier carries over.
    const changed = f.ask('content:changed')
    expect(changed.id).not.toBe(first.id)
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    server.decisions.set(changed.id, 'expired')
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    expect(f.approvals.get(f.podId, changed.id)).toMatchObject({ state: 'collecting', reason: expect.stringContaining('expired; asking again') })
  })

  it('never repeats an uncertain IdP request by itself and resumes only on the owner\'s decision', async () => {
    const f = fixture(); const server = idp()
    const asked = f.ask()
    server.failCreate()
    await expect(f.approvals.sync(f.podId, server.service, new AbortController().signal)).rejects.toThrow('connection reset')
    expect(f.approvals.get(f.podId, asked.id).state).toBe('unknown')
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    expect(server.calls.filter(call => call.operation === 'create')).toHaveLength(1)
    // An interrupted request (journal written, no grant recorded) is uncertain too.
    f.store.db.prepare('UPDATE action_approvals SET state=\'requested\',grant_id=NULL WHERE id=?').run(asked.id)
    await f.approvals.sync(f.podId, idp().service, new AbortController().signal)
    expect(f.approvals.get(f.podId, asked.id).state).toBe('unknown')
    expect(() => f.approvals.resolve(asked.id, 'renew', '')).toThrow('observation')
    f.approvals.resolve(asked.id, 'renew', 'No request is visible at the IdP')
    expect(f.approvals.get(f.podId, asked.id).state).toBe('collecting')
  })

  it('shows the owner a title derived from the bound message, never the script\'s, and binds the object to it', () => {
    const f = fixture()
    expect(f.ask().title).toBe(`${mail.subject} · news@example.invalid`)
    const request = (object: string, payload: Record<string, string>) => () => f.approvals.request(f.run, { action: 'mail.archive', object, payload })
    expect(request(`${mailbox}:other-message`, { mailbox, messageId: mail.id, version: 'v', subject: 's', sender: 'x@example.invalid' })).toThrow('mailbox and message ID')
    expect(request(`${mailbox}:${mail.id}`, { mailbox, messageId: mail.id, version: 'v', subject: 's' })).toThrow('subject and sender')
  })

  it('lets the desktop act only on the stored requests of the calling Pod', async () => {
    const f = fixture(); const server = idp()
    const asked = f.ask()
    let manifest: ApprovalManifest | undefined
    await f.approvals.sync(f.podId, async (body) => { manifest = body.manifest; f.approvals.authorize(f.podId, body.manifest, body.operation, body.grants); return server.service(body, new AbortController().signal) }, new AbortController().signal)
    const other = f.pod('Other')
    expect(() => f.approvals.authorize(other, manifest!, 'status', [{ key: asked.id, id: `grant-${asked.id}` }])).toThrow('another Pod')
    expect(() => f.approvals.authorize(f.podId, manifest!, 'consume', [{ key: asked.id, id: `grant-${asked.id}` }])).toThrow('does not match')
    expect(() => f.approvals.authorize(f.podId, manifest!, 'status', [{ key: asked.id, id: 'grant-forged' }])).toThrow('grant does not match')
    const forged = { ...manifest!, items: [{ ...manifest!.items[0]!, authority: { ...manifest!.items[0]!.authority, object: 'someone-else' } }] }
    expect(() => f.approvals.authorize(f.podId, forged, 'status', [{ key: asked.id, id: `grant-${asked.id}` }])).toThrow('does not match')
  })
})

describe('authorized mail archive', () => {
  async function approved(options: { current?: Partial<typeof mail>, move?: () => unknown, read?: () => unknown } = {}) {
    const f = fixture(); const server = idp()
    const asked = f.ask()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    server.decisions.set(asked.id, 'approved')
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    const moves: string[][] = []
    const tools = {
      read: vi.fn(async () => options.read?.() ?? reply('read', { outcome: 'confirmed', items: [{ ...mail, ...options.current }] })),
      move: vi.fn(async (argv: string[]) => { moves.push(argv); return options.move?.() ?? reply('move', { outcome: 'confirmed', beforeId: mail.id, afterId: 'archived-1', requestId: 'request-1', receipt: { id: 'archived-1', parentFolderId: 'archive-folder' } }) }),
    }
    const archive = (approval = asked.id) => archiveApproved(f.store, f.approvals, server.service, f.run, { application: 'mail', mailbox, approval }, tools, () => {}, new AbortController().signal)
    const effects = () => f.store.db.prepare('SELECT a.state, group_concat(r.outcome) AS receipts FROM effect_attempts a JOIN effect_receipts r ON r.action_key=a.action_key AND r.attempt=a.attempt GROUP BY a.action_key,a.attempt ORDER BY a.attempt').all()
    return { ...f, server, asked, tools, moves, archive, effects }
  }

  it('moves an approved message once with an intent and receipt, and never twice', async () => {
    const f = await approved()
    expect(await f.archive()).toMatchObject({ outcome: 'archived', reason: 'Moved to the Archive folder' })
    expect(f.moves).toEqual([['workflow', 'move', '--account', mailbox, '--message', mail.id, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']])
    expect(f.effects()).toEqual([{ state: 'confirmed_applied', receipts: 'intent,confirmed_applied' }])
    expect(await f.archive()).toMatchObject({ outcome: 'archived', reason: 'Already archived' })
    expect(f.moves).toHaveLength(1)
  })

  it('leaves a changed or different message in place', async () => {
    for (const current of [{ body: { content: 'Edited', contentType: 'text' } }, { subject: 'Invoice 42' }]) {
      const f = await approved({ current })
      expect(await f.archive()).toMatchObject({ outcome: 'skipped' })
      expect(f.moves).toEqual([])
      expect(f.effects()).toEqual([{ state: 'confirmed_not_applied', receipts: 'intent,confirmed_not_applied' }])
    }
  })

  it('holds an uncertain move and never moves that message again, not even with a new approval', async () => {
    const f = await approved({ move: () => reply('move', { outcome: 'unknown', reason: 'response unavailable after dispatch' }) })
    expect(await f.archive()).toMatchObject({ outcome: 'unknown' })
    expect(f.effects()).toEqual([{ state: 'unknown', receipts: 'intent,unknown' }])
    expect(await f.archive()).toMatchObject({ outcome: 'skipped', reason: expect.stringContaining('awaits reconciliation') })
    expect(f.moves).toHaveLength(1)
  })

  it('treats a crash after the intent as unknown at the next start', async () => {
    const f = await approved({ move: () => { throw new Error('worker killed') } })
    expect(await f.archive()).toMatchObject({ outcome: 'unknown' })
    expect(await f.archive()).toMatchObject({ outcome: 'skipped' })
    expect(f.moves).toHaveLength(1)
  })

  it('refuses to act on an approval that is not approved', async () => {
    const f = fixture(); const server = idp()
    const asked = f.ask()
    const moves = vi.fn()
    expect(await archiveApproved(f.store, f.approvals, server.service, f.run, { application: 'mail', mailbox, approval: asked.id }, { read: moves, move: moves }, () => {}, new AbortController().signal)).toMatchObject({ outcome: 'skipped', reason: 'The approval is collecting' })
    expect(moves).not.toHaveBeenCalled()
    expect(f.store.db.prepare('SELECT count(*) AS count FROM effect_attempts').get()!.count).toBe(0)
  })
})

describe('program approvals (issue 1468)', () => {
  const push = (sha: string) => ['push', `--force-with-lease=feature/x:${sha}`, 'origin', `${sha}:refs/heads/feature/x`]
  const lease = 'a'.repeat(40)

  async function approvedPush(argv = push(lease)) {
    const f = fixture(); const server = idp()
    const asked = f.approvals.request(f.run, { action: 'program.run', payload: { application: 'git', argv } }, 'Push to remote')
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    server.decisions.set(asked.id, 'approved')
    f.store.db.prepare('UPDATE approval_batches SET next_poll_at=0').run()
    await f.approvals.sync(f.podId, server.service, new AbortController().signal)
    const runs: { application: string, argv: string[] }[] = []
    const execute = vi.fn(async (command: { application: string, argv: string[] }) => { runs.push(command); return { exitCode: 0, stdout: '', stderr: '' } })
    const invoke = (request: { application: string, argv: string[], approval: string }) => invokeApproved(f.store, f.approvals, server.service, f.run, request, execute, () => {}, new AbortController().signal)
    return { ...f, server, asked, runs, execute, invoke }
  }

  it('derives the object from the exact command and shows the adapter display with the argv', async () => {
    const f = await approvedPush()
    expect(f.asked).toMatchObject({ action: 'program.run', object: programObject('git', push(lease)), title: `Push to remote: push --force-with-lease=feature/x:${lease} origin ${lease}:refs/heads/feature/x`.slice(0, 120) })
    expect(f.asked.object.startsWith(`git push --force-with-lease=feature/x:${lease}`)).toBe(true)
    // The authority the owner approves at the IdP carries the action and the exact command object.
    expect(JSON.parse(f.server.calls[0]!.commands[0]![2]!)).toMatchObject({ action: 'program.run', object: f.asked.object })
    // A new lease SHA is a different object and needs its own approval.
    const next = f.approvals.request(f.run, { action: 'program.run', payload: { application: 'git', argv: push('b'.repeat(40)) } }, 'Push to remote')
    expect(next.id).not.toBe(f.asked.id)
    expect(next.state).toBe('collecting')
    // The title never comes from the script, and the object cannot name another command.
    expect(() => f.approvals.request(f.run, { action: 'program.run', payload: { application: 'git', argv: push(lease) } })).toThrow('adapter description')
    expect(() => f.approvals.request(f.run, { action: 'program.run', object: 'git status', payload: { application: 'git', argv: push(lease) } }, 'Push to remote')).toThrow('exact command')
    expect(() => f.approvals.request(f.run, { action: 'program.run', payload: { application: 'git', argv: push(lease), note: 'x' } }, 'Push to remote')).toThrow('application and its exact argv')
  })

  it('consumes an approved request and runs the exact command once, refusing a second use', async () => {
    const f = await approvedPush()
    expect(await f.invoke({ application: 'git', argv: push(lease), approval: f.asked.id })).toEqual({ exitCode: 0, stdout: '', stderr: '' })
    expect(f.runs).toEqual([{ application: 'git', argv: push(lease) }])
    expect(f.approvals.get(f.podId, f.asked.id).state).toBe('consumed')
    expect(f.server.calls.filter(call => call.operation === 'consume')).toHaveLength(1)
    expect(f.store.db.prepare('SELECT effect_key,operation,state FROM effect_ledger').all()).toEqual([{ effect_key: `approval:${f.asked.id}`, operation: 'program.call', state: 'completed' }])
    await expect(f.invoke({ application: 'git', argv: push(lease), approval: f.asked.id })).rejects.toThrow('The approval is consumed')
    expect(f.runs).toHaveLength(1)
    expect(f.server.calls.filter(call => call.operation === 'consume')).toHaveLength(1)
  })

  it('refuses a different command, a foreign Pod and an undecided or denied approval before anything runs', async () => {
    const f = await approvedPush()
    await expect(f.invoke({ application: 'git', argv: push('b'.repeat(40)), approval: f.asked.id })).rejects.toThrow('different command')
    await expect(f.invoke({ application: 'other', argv: push(lease), approval: f.asked.id })).rejects.toThrow('different command')
    const other = { podId: f.pod('Other'), runId: f.run.runId }
    await expect(invokeApproved(f.store, f.approvals, f.server.service, other, { application: 'git', argv: push(lease), approval: f.asked.id }, f.execute, () => {}, new AbortController().signal)).rejects.toThrow('not found for this Pod')
    const pending = f.approvals.request(f.run, { action: 'program.run', payload: { application: 'git', argv: push('c'.repeat(40)) } }, 'Push to remote')
    await expect(f.invoke({ application: 'git', argv: push('c'.repeat(40)), approval: pending.id })).rejects.toThrow('The approval is collecting')
    const mail = f.ask()
    await expect(f.invoke({ application: 'git', argv: push(lease), approval: mail.id })).rejects.toThrow('does not name a program command')
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.approvals.get(f.podId, f.asked.id).state).toBe('approved')
    expect(f.store.db.prepare('SELECT count(*) AS count FROM effect_ledger').get()).toEqual({ count: 0 })
  })

  it('lets the desktop run a command without a grant only for the consumed approval of its open effect', async () => {
    const f = await approvedPush()
    const command = { application: 'git', argv: push(lease) }
    expect(() => f.approvals.assertExecution(f.run, f.asked.id, command)).toThrow('No consumed approval')
    let checked = false
    f.execute.mockImplementation(async () => {
      f.approvals.assertExecution(f.run, f.asked.id, command)
      expect(() => f.approvals.assertExecution(f.run, f.asked.id, { ...command, argv: push('b'.repeat(40)) })).toThrow('No consumed approval')
      expect(() => f.approvals.assertExecution({ ...f.run, runId: randomUUID() }, f.asked.id, command)).toThrow('another run')
      checked = true
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await f.invoke({ ...command, approval: f.asked.id })
    expect(checked).toBe(true)
    expect(() => f.approvals.assertExecution(f.run, f.asked.id, command)).toThrow('already ran')
  })

  it('describes a command with the application adapter and refuses mail moves and unknown operations', async () => {
    const f = fixture()
    const adapter = join(f.root, 'git.toml')
    writeFileSync(adapter, ['schema = "openape-shapes/v1"', '[cli]', 'id = "git"', 'executable = "git"', 'audience = "shapes"', 'version = "1"', '[[operation]]', 'id = "git.push"', 'command = ["push"]', 'positionals = ["remote", "refspec"]', 'display = "Push {refspec} to {remote}"', 'action = "edit"', 'risk = "high"', 'resource_chain = ["repo:*", "remote:*"]', '[[operation]]', 'id = "git.move"', 'command = ["move"]', 'display = "Move"', 'action = "move"', 'risk = "high"', 'resource_chain = ["repo:*"]', ''].join('\n'))
    const configuration = { type: 'program', name: 'git', cliId: 'git', adapterPath: adapter, adapterHash: createHash('sha256').update(readFileSync(adapter)).digest('hex'), capability: 'tool.app_git.invoke' }
    const resources = [{ id: randomUUID(), podId: f.podId, revision: 1, kind: 'tool', state: 'ready', name: 'git', configuration }] as never
    expect(await describeProgram(resources, f.podId, ['tool.app_git.invoke'], { application: 'git', argv: push(lease) })).toBe(`Push ${lease}:refs/heads/feature/x to origin`)
    await expect(describeProgram(resources, f.podId, ['tool.app_git.invoke'], { application: 'git', argv: ['fetch'] })).rejects.toThrow('No adapter operation matched')
    await expect(describeProgram(resources, f.podId, ['tool.app_git.invoke'], { application: 'git', argv: ['move'] })).rejects.toThrow('approved archive service')
    await expect(describeProgram(resources, f.podId, [], { application: 'git', argv: push(lease) })).rejects.toThrow('not declared and assigned')
  })
})
