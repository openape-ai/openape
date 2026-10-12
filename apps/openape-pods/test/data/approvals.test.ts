// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Approvals } from '../../src/worker/data/approvals'
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
  const ask = (version = mailContentVersion(mail), subject = mail.subject) => approvals.request(run, { action: 'mail.archive', object: `${mailbox}:${mail.id}`, title: `${subject} · news@example.invalid`, payload: { mailbox, messageId: mail.id, version, subject, sender: 'news@example.invalid' } })
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
