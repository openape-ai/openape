import { parseFrame } from '../../src/contracts/runs'
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { ArchiveStore } from '../../src/main/mail/archive/store'
import { MailArchiveService } from '../../src/main/mail/archive/service'
import type { ArchiveAuthority, ArchiveProvider } from '../../src/main/mail/archive/service'
import { archiveItemCommand, archiveItemSummary, parseArchiveProposal } from '../../src/contracts/mail-archive'
import type { ArchiveMail, ArchiveManifest } from '../../src/contracts/mail-archive'
import { loadAdapter, resolveCommand } from '@openape/apes'

it('accepts archive prepare and process requests across the script frame boundary', () => {
  for (const payload of [{ operation: 'prepare', proposal: { application: 'pods-mail', mailbox: 'owner@example.test', items: [] } }, { operation: 'process' }]) {
    const frame = { version: 1, runId: 'run', sequence: 1, type: 'request', id: 'request-1', operation: 'mail.archive', payload }
    expect(parseFrame(JSON.parse(JSON.stringify(frame)), 'run', 1)).toEqual(frame)
    expect(() => parseFrame({ ...frame, operation: 'mail.execute' }, 'run', 1)).toThrow('Unsupported')
  }
})
const roots: string[] = []
it('reuses account-scoped read assignments for concrete messages and conversations', async () => {
  const adapter = loadAdapter('pods-mail', join(process.cwd(), 'examples/microsoft-mail-shapes.toml'))
  for (const [operation, option] of [['read', '--message'], ['thread', '--conversation']]) {
    const command = (account: string, id: string) => resolveCommand(adapter, ['pods-mail', operation!, '--account', account, option!, id])
    const assigned = await command('owner@example.test', '*')
    expect((await command('owner@example.test', 'concrete-provider-id')).permission).toBe(assigned.permission)
    expect((await command('other@example.test', 'concrete-provider-id')).permission).not.toBe(assigned.permission)
  }
})
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.useRealTimers() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pods-mail-archive-')); roots.push(root)
  const store = new ArchiveStore(root); const service = new MailArchiveService(store); const podId = randomUUID()
  const mail: ArchiveMail = { id: 'immutable-message-1', version: 'reviewed-v1', folder: 'inbox-id', internetMessageId: '<message@example.test>', sender: 'sender@example.test', subject: 'Completed notification', receivedAt: '2026-09-26T05:00:00Z', url: 'https://outlook.office.com/mail/id/one' }
  const provider: ArchiveProvider = { applicationId: randomUUID(), applicationHash: 'pinned', read: vi.fn(async () => mail), move: vi.fn(async item => ({ state: 'archived' as const, receipt: { ...item, folder: 'archive-id', version: 'moved-v2' } })) }
  const authority: ArchiveAuthority = { create: vi.fn(async (manifest: ArchiveManifest) => ({ id: manifest.id, url: 'https://id.example.test/grant-approval?batch=fixture', grants: manifest.items.map(item => ({ id: item.id, grantId: randomUUID() })) })), statuses: vi.fn(), consume: vi.fn(), assertActive: vi.fn() }
  /** The owner's decision per message; unlisted messages get `others`. */
  const decide = (others: 'pending' | 'approved' | 'denied' | 'expired', per: Record<string, 'approved' | 'denied'> = {}) => vi.mocked(authority.statuses).mockImplementation(async record => Object.fromEntries(record.manifest.items.map(item => [item.id, per[item.id] ?? others])))
  decide('pending')
  const proposal = { application: 'pods-mail', mailbox: 'owner@example.test', items: [{ id: mail.id, version: mail.version, reason: 'Completed; nothing to do' }] }
  return { store, service, podId, mail, provider, authority, proposal, decide }
}
it('freezes provider metadata and binds one grant to each message', async () => {
  const f = await fixture()
  const prepared = await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  const [record] = await f.store.list(f.podId)
  expect(prepared).toMatchObject({ state: 'pending', count: 1 })
  expect(record!.grants).toEqual([{ id: f.mail.id, grantId: expect.any(String) }])
  const item = record!.manifest.items[0]!
  const summary = archiveItemSummary(item)
  expect(summary.split('\n')[0]).toBe(`${f.mail.sender} – ${f.mail.subject}`)
  for (const text of [f.mail.receivedAt, f.mail.url, f.proposal.items[0]!.reason]) expect(summary).toContain(text)
  for (const text of [f.mail.version, f.proposal.mailbox, record!.manifest.id]) expect(archiveItemCommand(record!.manifest, item).join(' ')).toContain(text)
  expect(f.provider.move).not.toHaveBeenCalled()
  expect(f.authority.consume).not.toHaveBeenCalled()
})
it.each(['pending', 'denied', 'expired'] as const)('does not move mail for a %s decision', async (status) => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  f.decide(status)
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]?.state).toBe(status)
  expect(f.provider.move).not.toHaveBeenCalled(); expect(f.authority.consume).not.toHaveBeenCalled()
})
it('consumes exactly once and never adds new mail to the approved batch', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  f.decide('approved')
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'completed', outcomes: [{ id: f.mail.id, state: 'archived' }] })
  await new MailArchiveService(f.store).process(f.podId, async () => f.provider, f.authority)
  expect(f.authority.consume).toHaveBeenCalledTimes(1); expect(f.provider.move).toHaveBeenCalledTimes(1)
})
it.each(['changed', 'moved'] as const)('skips a %s message after approval', async (change) => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  f.decide('approved')
  vi.mocked(f.provider.read).mockResolvedValue(change === 'moved' ? null : { ...f.mail, version: 'new-version' })
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'completed', outcomes: [{ state: 'skipped' }] })
  expect(f.provider.move).not.toHaveBeenCalled()
})
it('refuses changed identity between classification and grant preparation', async () => {
  const f = await fixture(); vi.mocked(f.provider.read).mockResolvedValue({ ...f.mail, version: 'changed' })
  await expect(f.service.prepare(f.podId, f.proposal, f.provider, f.authority)).rejects.toThrow('No new unchanged')
  expect(f.authority.create).not.toHaveBeenCalled()
})
it('retains an uncertain move across restart and never retries it', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  f.decide('approved'); vi.mocked(f.provider.move).mockRejectedValue(new Error('Connection lost after POST'))
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'unknown', outcomes: [{ state: 'unknown' }] })
  await new MailArchiveService(f.store).process(f.podId, async () => f.provider, f.authority)
  expect(f.provider.move).toHaveBeenCalledTimes(1)
  await expect(f.service.prepare(f.podId, f.proposal, f.provider, f.authority)).rejects.toThrow('reconciliation')
})
it('refuses changed program bindings and expired approved batches', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority); f.decide('approved')
  expect((await f.service.process(f.podId, async () => ({ ...f.provider, applicationHash: 'changed' }), f.authority))[0]).toMatchObject({ state: 'expired', error: expect.stringContaining('application changed') })
  expect(f.authority.consume).not.toHaveBeenCalled()
  await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000)
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]?.state).toBe('expired')
  expect(f.provider.move).not.toHaveBeenCalled()
})
it('validates proposal identities and resolves the companion archive operation exactly', async () => {
  const f = await fixture()
  expect(parseArchiveProposal(f.proposal)).toEqual(f.proposal)
  expect(() => parseArchiveProposal({ ...f.proposal, items: [...f.proposal.items, ...f.proposal.items] })).toThrow('Duplicate')
  const adapter = loadAdapter('pods-mail', join(process.cwd(), 'examples/microsoft-mail-shapes.toml'))
  const resolved = await resolveCommand(adapter, ['pods-mail', 'archive', '--account', f.proposal.mailbox, '--message', f.mail.id, '--version', f.mail.version, '--folder', f.mail.folder])
  expect(resolved.detail).toMatchObject({ operation_id: 'archive', action: 'archive', constraints: { exact_command: true } })
})

it('keeps every message grant within the broker limits and leaves out only messages that cannot fit', async () => {
  const f = await fixture()
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `mail-${index}`, version: 'v1', reason: 'Completed '.repeat(30) }))
  vi.mocked(f.provider.read).mockImplementation(async id => ({ ...f.mail, id, version: 'v1', subject: id === 'mail-3' ? 'x'.repeat(2048) : 'An informative subject '.repeat(10), url: id === 'mail-3' ? `https://outlook.office.com/mail/id/${'a'.repeat(2000)}` : f.mail.url }))
  const prepared = await f.service.prepare(f.podId, { ...f.proposal, items }, f.provider, f.authority)
  const [record] = await f.store.list(f.podId)
  expect(prepared.count).toBe(items.length - 1)
  expect(record!.manifest.items.map(item => item.id)).not.toContain('mail-3')
  for (const item of record!.manifest.items) expect(archiveItemCommand(record!.manifest, item).every(argument => argument.length <= 4096)).toBe(true)
})

it('moves only the approved messages of a partly approved proposal', async () => {
  const f = await fixture()
  const items = ['mail-1', 'mail-2'].map(id => ({ id, version: 'v1', reason: 'Completed' }))
  vi.mocked(f.provider.read).mockImplementation(async id => ({ ...f.mail, id, version: 'v1' }))
  await f.service.prepare(f.podId, { ...f.proposal, items }, f.provider, f.authority)
  f.decide('approved', { 'mail-2': 'denied' })
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'completed', outcomes: [{ id: 'mail-1', state: 'archived' }, { id: 'mail-2', state: 'skipped', reason: 'Not approved by the owner' }] })
  expect(vi.mocked(f.authority.consume).mock.calls.map(call => call[1])).toEqual(['mail-1'])
  expect(vi.mocked(f.provider.move).mock.calls.map(call => call[0].id)).toEqual(['mail-1'])
})

it('expires a proposal approved under one collective grant without consuming it', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  const [record] = await f.store.list(f.podId)
  await f.store.save({ ...record!, grants: undefined })
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'expired', error: expect.stringContaining('one grant per message') })
  expect(f.authority.statuses).not.toHaveBeenCalled(); expect(f.provider.move).not.toHaveBeenCalled()
})

it('supersedes pending grants when the reviewed application changes without consuming old authority', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  const prepared = await f.service.prepare(f.podId, f.proposal, { ...f.provider, applicationHash: 'new-policy' }, f.authority)
  expect(prepared.state).toBe('pending')
  expect((await f.store.list(f.podId)).map(record => record.state).sort()).toEqual(['expired', 'pending'])
  expect(f.authority.consume).not.toHaveBeenCalled(); expect(f.provider.move).not.toHaveBeenCalled()
})
