import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import type { MailRead, MailScope } from '../../main/mail/contract'
import type { MailItem, MailPage } from './ingestion'
import { MailKnowledge, recipeVersion } from './knowledge'
import type { EvidenceText } from './knowledge'
import type { Extraction } from './parsers/extract'

export function mailToolRequest(scope: MailScope, request: MailRead) {
  const argv = ['o365-cli', 'pods', 'read', '--account', scope.account, '--operation', request.operation, '--folder', request.folder]
  for (const key of ['message', 'attachment', 'cursor'] as const) {
    if (request[key]) argv.push(`--${key}`, request[key])
  }
  return { toolId: 'o365-mail', argv }
}
export class MailRecipeSession {
  private readonly knowledge: MailKnowledge
  private begun = false
  private contextHash: string | null = null
  private attachmentBytes = 0
  private readonly extracted = new Map<string, EvidenceText>()
  constructor(private readonly store: PodDatabase, private readonly podId: string, private readonly scope: MailScope, private readonly read: (request: MailRead) => Promise<MailPage>, private readonly extract: (source: Buffer) => Promise<Extraction>, private readonly assertCurrent: () => void, recipeIdentity = recipeVersion) {
    this.knowledge = new MailKnowledge(store, podId, recipeIdentity)
  }

  async next(): Promise<unknown> {
    this.assertCurrent()
    if (this.contextHash) throw new Error('Commit or fail the prepared unit before requesting more mail')
    const scopeHash = digest(JSON.stringify(this.scope))
    let inventory = this.store.db.prepare('SELECT * FROM mail_inventory WHERE pod_id=?').get(this.podId)
    if (!inventory || inventory.scope !== scopeHash || (!this.begun && inventory.phase === 'idle')) {
      this.store.db.prepare('INSERT INTO mail_inventory VALUES(?,?,\'inventory\',0,NULL,NULL) ON CONFLICT(pod_id) DO UPDATE SET scope=excluded.scope,phase=excluded.phase,folder_index=0,cursor=NULL').run(this.podId, scopeHash)
      inventory = this.store.db.prepare('SELECT * FROM mail_inventory WHERE pod_id=?').get(this.podId)
    }
    this.begun = true
    if (!inventory) throw new Error('Mail inventory is unavailable')
    if (inventory.phase === 'inventory') {
      const folderIndex = inventory.folder_index as number
      const folder = this.scope.folders[folderIndex]
      if (!folder) throw new Error('Mail inventory scope changed')
      const page = await this.read({ operation: 'messages', folder, ...(inventory.cursor ? { cursor: inventory.cursor as string } : {}) })
      this.assertCurrent()
      if (page.nextCursor && page.nextCursor === inventory.cursor) throw new Error('Mail pagination did not advance')
      const nextFolder = folderIndex + (page.complete ? 1 : 0)
      const phase = nextFolder === this.scope.folders.length ? 'processing' : 'inventory'
      const checkpoint = this.store.checkpoint(this.podId)
      const revision = this.store.commitProgress({ podId: this.podId, expectedRevision: checkpoint.revision, checkpoint: { ...checkpoint.body, mailInventory: { phase, folder: nextFolder, complete: phase === 'processing' } }, sources: [], claims: [] }, undefined, () => {
        this.store.db.prepare('UPDATE mail_inventory SET phase=?,folder_index=?,cursor=?,completed_at=? WHERE pod_id=?').run(phase, nextFolder, page.nextCursor, phase === 'processing' ? Date.now() : null, this.podId)
      })
      return { type: 'inventory', revision, count: page.items.length, foldersComplete: nextFolder, folders: this.scope.folders.length }
    }
    const pending = this.knowledge.pending(this.scope)
    if (!pending) { this.store.db.prepare('UPDATE mail_inventory SET phase=\'idle\' WHERE pod_id=?').run(this.podId); return { type: 'done' } }
    const group = this.knowledge.conversation(pending, this.scope)
    const evidence: EvidenceText[] = []
    for (const item of group.items) {
      evidence.push(await this.examine(item.sourceId))
      if (item.hasAttachments) evidence.push(...await this.attachments(item))
    }
    this.assertCurrent()
    const prepared = this.knowledge.context(group.items, evidence, this.scope, group.omitted)
    this.contextHash = prepared.hash
    return { type: 'context', hash: prepared.hash, prompt: prepared.prompt, sources: prepared.context.evidence.length, omissions: prepared.context.omissions }
  }

  commit(value: unknown): { revision: number, gapIds: string[] } {
    this.assertCurrent()
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['hash', 'response'].includes(key))) throw new Error('Invalid mail commit')
    const request = value as { hash?: unknown, response?: unknown }
    if (!this.contextHash || request.hash !== this.contextHash || typeof request.response !== 'string') throw new Error('Mail commit does not match the prepared unit')
    const result = this.knowledge.commit(this.contextHash, request.response)
    this.contextHash = null
    return result
  }

  private raw(sourceId: string): Buffer {
    const row = this.store.db.prepare('SELECT hash FROM sources WHERE pod_id=? AND id=? ORDER BY rowid DESC LIMIT 1').get(this.podId, sourceId)
    if (!row) throw new Error('Mail source is unavailable')
    return this.store.readBlob(row.hash as string)
  }

  private async examine(sourceId: string): Promise<EvidenceText> {
    const existing = this.extracted.get(sourceId)
    if (existing) return existing
    const result = await this.extract(this.raw(sourceId)); this.assertCurrent()
    const evidence = this.knowledge.retainExtraction(sourceId, result)
    this.extracted.set(sourceId, evidence)
    return evidence
  }

  private gap(sourceId: string, message: string): EvidenceText {
    return this.knowledge.retainExtraction(sourceId, { text: '', gap: message, parser: `${recipeVersion}/not-examined` })
  }

  private async attachments(item: MailItem): Promise<EvidenceText[]> {
    if (!this.scope.attachments) return [this.gap(item.sourceId, 'Attachments exist but their read permission is not assigned')]
    const metadata = this.store.db.prepare('SELECT folder FROM mail_items WHERE pod_id=? AND source_id=?').get(this.podId, item.sourceId)
    if (!metadata) throw new Error('Mail source folder is unavailable')
    const folder = metadata.folder as string
    const evidence: EvidenceText[] = []
    const page = await this.read({ operation: 'attachments', folder, message: item.id })
    for (const attachment of page.items.slice(0, 3)) {
      const source = JSON.parse(this.raw(attachment.sourceId).toString()) as { data: { size?: unknown, contentType?: unknown, '@odata.type'?: unknown } }
      const size = source.data.size
      if (typeof size !== 'number' || size < 0 || size > 20 * 1024 * 1024 || this.attachmentBytes + size > 100 * 1024 * 1024 || source.data['@odata.type'] !== '#microsoft.graph.fileAttachment') { evidence.push(this.gap(attachment.sourceId, 'Attachment is unsupported or exceeds the file/run byte limit')); continue }
      const content = await this.read({ operation: 'attachment', folder, message: item.id, attachment: attachment.id })
      if (content.items.length !== 1) throw new Error('Attachment read returned no unique source')
      const raw = JSON.parse(this.raw(content.items[0].sourceId).toString()) as { data: { contentBytes?: unknown } }
      const actualSize = typeof raw.data.contentBytes === 'string' ? Buffer.byteLength(raw.data.contentBytes, 'base64') : Infinity
      if (actualSize > 20 * 1024 * 1024 || this.attachmentBytes + actualSize > 100 * 1024 * 1024) { evidence.push(this.gap(content.items[0].sourceId, 'Attachment bytes exceed the file/run extraction limit')); continue }
      this.attachmentBytes += actualSize
      evidence.push(await this.examine(content.items[0].sourceId))
    }
    if (page.items.length > 3) evidence.push(this.gap(item.sourceId, 'Attachment count exceeds the context limit; remaining attachments are unexamined'))
    if (!page.complete) evidence.push(this.gap(item.sourceId, 'Attachment pagination exceeds the context limit; remaining attachments are unexamined'))
    return evidence
  }
}
export const mailRecipe = `export async function run(context) {
  const gaps = new Set();
  const result = (summary) => ({status:gaps.size?'completedWithGaps':'completed',summary,completedInputIds:context.input.eventIds,gapIds:[...gaps].slice(0,1000)});
  for (let unit = 0; unit < 20; unit++) {
    const next = await context.mail.next();
    if (next.type === 'done') return result('Mail inventory and supported knowledge are up to date');
    if (next.type === 'inventory') { context.log('Mail inventory: '+next.foldersComplete+'/'+next.folders+' folders'); continue; }
    const answer = await context.agent.run({prompt:next.prompt});
    const committed = await context.mail.commit({hash:next.hash,response:answer.response});
    for (const id of committed.gapIds) gaps.add(id);
    context.log('Committed sourced mail knowledge revision '+committed.revision);
  }
  return result('Bounded mail batch committed; remaining inventory or knowledge continues on the next run');
}`
