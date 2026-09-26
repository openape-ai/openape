import { randomUUID } from 'node:crypto'
import type { ArchiveMail, ArchiveManifest, ArchiveProposal, ArchiveRecord, ArchiveView } from '../../../contracts/mail-archive'
import { archiveCommand, archiveSummary, parseArchiveMail, sameArchiveMail } from '../../../contracts/mail-archive'
import type { ArchiveStore } from './store'

export interface ArchiveProvider {
  applicationId: string
  applicationHash: string
  read: (id: string) => Promise<ArchiveMail | null>
  move: (mail: ArchiveMail) => Promise<{ state: 'archived', receipt: ArchiveMail } | { state: 'skipped', reason: string }>
}
export interface ArchiveAuthority {
  create: (manifest: ArchiveManifest) => Promise<{ id: string, url: string }>
  status: (record: ArchiveRecord) => Promise<'pending' | 'approved' | 'denied' | 'expired'>
  consume: (record: ArchiveRecord) => Promise<void>
  assertActive: (record: ArchiveRecord) => Promise<void>
}
function view(record: ArchiveRecord): ArchiveView { return { id: record.manifest.id, mailbox: record.manifest.mailbox, count: record.manifest.items.length, state: record.state, url: record.url, outcomes: record.outcomes, error: record.error } }
export class MailArchiveService {
  private busy = new Set<string>()
  constructor(private readonly store: ArchiveStore) {}
  async run<T>(podId: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(podId)) throw new Error('Mail archive operation already running for this Pod')
    this.busy.add(podId)
    try { return await work() }
    finally { this.busy.delete(podId) }
  }

  async prepare(podId: string, proposal: ArchiveProposal, provider: ArchiveProvider, authority: ArchiveAuthority): Promise<ArchiveView> {
    const records = await this.store.list(podId)
    const unresolved = records.filter(record => ['preparing', 'executing', 'unknown'].includes(record.state))
    if (unresolved.length) throw new Error('An archive operation needs reconciliation before another proposal')
    const pending = records.filter(record => record.state === 'pending' && record.manifest.expiresAt > Date.now())
    if (pending.length >= 4) throw new Error('Review outstanding mail archive grants before preparing more')
    const items = []
    for (const proposed of proposal.items) {
      if (pending.some(record => record.manifest.mailbox === proposal.mailbox && record.manifest.items.some(mail => mail.id === proposed.id))) continue
      const mail = await provider.read(proposed.id)
      if (!mail || mail.id !== proposed.id || mail.version !== proposed.version) continue
      items.push({ ...parseArchiveMail(mail), reason: proposed.reason })
    }
    if (!items.length) throw new Error('No new unchanged Inbox messages remain for this proposal')
    const manifest: ArchiveManifest = { version: 1, id: randomUUID(), podId, applicationId: provider.applicationId, applicationHash: provider.applicationHash, mailbox: proposal.mailbox, expiresAt: Date.now() + 12 * 60 * 60 * 1000, items }
    while (manifest.items.length && (archiveSummary(manifest).length > 4096 || archiveCommand(manifest).some(argument => argument.length > 4096))) manifest.items.pop()
    if (!manifest.items.length) throw new Error('Archive message details exceed the grant display limit')
    if (Buffer.byteLength(JSON.stringify(manifest)) > 48000) throw new Error('Archive proposal is too large; use fewer messages')
    const record: ArchiveRecord = { manifest, state: 'preparing', outcomes: [] }
    await this.store.save(record)
    try {
      const grant = await authority.create(manifest)
      record.grantId = grant.id; record.url = grant.url; record.state = 'pending'
      await this.store.save(record)
      return view(record)
    }
    catch (error) {
      record.state = 'unknown'; record.error = `Grant creation requires review: ${String(error)}`
      await this.store.save(record)
      throw error
    }
  }

  async process(podId: string, providerFor: (record: ArchiveRecord) => Promise<ArchiveProvider>, authority: ArchiveAuthority): Promise<ArchiveView[]> {
    const records = await this.store.list(podId)
    const output: ArchiveView[] = []
    for (const record of records.filter(record => ['preparing', 'executing'].includes(record.state))) {
      record.state = 'unknown'; record.error = 'Interrupted archive operation; inspect grant and provider receipts before proceeding'
      await this.store.save(record)
    }
    const unresolved = records.filter(record => record.state === 'unknown')
    if (unresolved.length) return unresolved.map(view)
    for (const record of records) {
      if (record.state !== 'pending') { if (record.state === 'unknown') output.push(view(record)); continue }
      if (record.manifest.expiresAt <= Date.now()) { record.state = 'expired'; await this.store.save(record); output.push(view(record)); continue }
      const status = await authority.status(record)
      if (status === 'pending') { output.push(view(record)); continue }
      if (status !== 'approved') { record.state = status; await this.store.save(record); output.push(view(record)); continue }
      const provider = await providerFor(record)
      if (provider.applicationId !== record.manifest.applicationId || provider.applicationHash !== record.manifest.applicationHash) throw new Error('Mail application changed; the old archive grant cannot execute')
      record.state = 'executing'; await this.store.save(record)
      try {
        await authority.consume(record)
        for (const item of record.manifest.items) {
          if (record.manifest.expiresAt <= Date.now()) { record.outcomes.push({ id: item.id, state: 'skipped', reason: 'Archive approval expired' }); await this.store.save(record); continue }
          await authority.assertActive(record)
          const current = await provider.read(item.id)
          if (!current || !sameArchiveMail(item, parseArchiveMail(current))) {
            record.outcomes.push({ id: item.id, state: 'skipped', reason: 'Message changed or is no longer in the Inbox' }); await this.store.save(record); continue
          }
          record.outcomes.push({ id: item.id, state: 'unknown', reason: 'Move started; provider receipt pending' }); await this.store.save(record)
          const result = await provider.move(item)
          const outcome = record.outcomes.at(-1)!
          if (result.state === 'skipped') { outcome.state = 'skipped'; outcome.reason = result.reason }
          else {
            const receipt = parseArchiveMail(result.receipt)
            if (receipt.id !== item.id || receipt.internetMessageId !== item.internetMessageId || receipt.folder === item.folder) throw new Error('Archive receipt does not identify the reviewed message')
            outcome.state = 'archived'; outcome.reason = 'Provider confirmed archival'; outcome.receipt = receipt
          }
          await this.store.save(record)
        }
        record.state = 'completed'; await this.store.save(record)
      }
      catch (error) { record.state = 'unknown'; record.error = String(error); await this.store.save(record) }
      output.push(view(record))
      if (record.state === 'unknown') break
    }
    return output
  }
}
