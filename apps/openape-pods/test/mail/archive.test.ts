// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { ArchiveStore } from '../../src/main/mail/archive/store'
import { MailArchiveService } from '../../src/main/mail/archive/service'
import type { ArchiveAuthority, ArchiveProvider } from '../../src/main/mail/archive/service'
import { archiveCommand, archiveSummary, parseArchiveProposal } from '../../src/contracts/mail-archive'
import type { ArchiveMail } from '../../src/contracts/mail-archive'
import { loadAdapter, resolveCommand } from '@openape/apes'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.useRealTimers() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pods-mail-archive-')); roots.push(root)
  const store = new ArchiveStore(root); const service = new MailArchiveService(store); const podId = randomUUID()
  const mail: ArchiveMail = { id: 'immutable-message-1', version: 'reviewed-v1', folder: 'inbox-id', internetMessageId: '<message@example.test>', sender: 'sender@example.test', subject: 'Completed notification', receivedAt: '2026-09-26T05:00:00Z', url: 'https://outlook.office.com/mail/id/one' }
  const provider: ArchiveProvider = { applicationId: randomUUID(), applicationHash: 'pinned', read: vi.fn(async () => mail), move: vi.fn(async item => ({ state: 'archived' as const, receipt: { ...item, folder: 'archive-id', version: 'moved-v2' } })) }
  const authority: ArchiveAuthority = { create: vi.fn(async () => ({ id: randomUUID(), url: 'https://id.example.test/grant-approval?grant_id=fixture' })), status: vi.fn(async () => 'pending' as const), consume: vi.fn(), assertActive: vi.fn() }
  const proposal = { application: 'pods-mail', mailbox: 'owner@example.test', items: [{ id: mail.id, version: mail.version, reason: 'Completed; nothing to do' }] }
  return { store, service, podId, mail, provider, authority, proposal }
}
it('freezes provider metadata and shows every message in the bound grant', async () => {
  const f = await fixture()
  const prepared = await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  const [record] = await f.store.list(f.podId)
  expect(prepared).toMatchObject({ state: 'pending', count: 1 })
  const summary = archiveSummary(record!.manifest)
  for (const text of [f.mail.subject, f.mail.sender, f.mail.receivedAt, f.mail.url, f.proposal.mailbox, f.proposal.items[0]!.reason]) expect(summary).toContain(text)
  expect(archiveCommand(record!.manifest).join(' ')).toContain(f.mail.version)
  expect(f.provider.move).not.toHaveBeenCalled()
  expect(f.authority.consume).not.toHaveBeenCalled()
})
it.each(['pending', 'denied', 'expired'] as const)('does not move mail for a %s decision', async (status) => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  vi.mocked(f.authority.status).mockResolvedValue(status)
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]?.state).toBe(status)
  expect(f.provider.move).not.toHaveBeenCalled(); expect(f.authority.consume).not.toHaveBeenCalled()
})
it('consumes exactly once and never adds new mail to the approved batch', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  vi.mocked(f.authority.status).mockResolvedValue('approved')
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'completed', outcomes: [{ id: f.mail.id, state: 'archived' }] })
  await new MailArchiveService(f.store).process(f.podId, async () => f.provider, f.authority)
  expect(f.authority.consume).toHaveBeenCalledTimes(1); expect(f.provider.move).toHaveBeenCalledTimes(1)
})
it.each(['changed', 'moved'] as const)('skips a %s message after approval', async (change) => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority)
  vi.mocked(f.authority.status).mockResolvedValue('approved')
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
  vi.mocked(f.authority.status).mockResolvedValue('approved'); vi.mocked(f.provider.move).mockRejectedValue(new Error('Connection lost after POST'))
  expect((await f.service.process(f.podId, async () => f.provider, f.authority))[0]).toMatchObject({ state: 'unknown', outcomes: [{ state: 'unknown' }] })
  await new MailArchiveService(f.store).process(f.podId, async () => f.provider, f.authority)
  expect(f.provider.move).toHaveBeenCalledTimes(1)
  await expect(f.service.prepare(f.podId, f.proposal, f.provider, f.authority)).rejects.toThrow('reconciliation')
})
it('refuses changed program bindings and expired approved batches', async () => {
  const f = await fixture(); await f.service.prepare(f.podId, f.proposal, f.provider, f.authority); vi.mocked(f.authority.status).mockResolvedValue('approved')
  await expect(f.service.process(f.podId, async () => ({ ...f.provider, applicationHash: 'changed' }), f.authority)).rejects.toThrow('application changed')
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

it('keeps every displayed grant within the broker limits without hiding listed messages', async () => {
  const f = await fixture()
  const items = Array.from({ length: 20 }, (_, index) => ({ id: `mail-${index}`, version: 'v1', reason: 'Completed '.repeat(30) }))
  vi.mocked(f.provider.read).mockImplementation(async id => ({ ...f.mail, id, version: 'v1', subject: 'An informative subject '.repeat(10) }))
  const prepared = await f.service.prepare(f.podId, { ...f.proposal, items }, f.provider, f.authority)
  const [record] = await f.store.list(f.podId)
  expect(prepared.count).toBeGreaterThan(0); expect(prepared.count).toBeLessThan(items.length)
  expect(archiveSummary(record!.manifest).length).toBeLessThanOrEqual(4096)
  expect(archiveCommand(record!.manifest).every(argument => argument.length <= 4096)).toBe(true)
  for (const mail of record!.manifest.items) expect(archiveSummary(record!.manifest)).toContain(mail.subject)
})
