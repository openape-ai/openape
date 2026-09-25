import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import { EffectLedger } from '../recovery/effects'
import { parseWorkflowMail } from '../../contracts/mail-workflow'
import type { MailBatchReview, MailEffectResolution, MailEffectOutcome, MailFilterResult, MailMoveReceipt, MailWorkflowConfiguration, WorkflowMail } from '../../contracts/mail-workflow'
import { classifyMail, protectedPartner } from './workflow-policy'

export interface WorkflowMailTransport {
  assertCurrent: () => void
  conditionalMoveVerified: boolean
  delta: (cursor: string | null) => Promise<{ items: WorkflowMail[], removed: string[], next: string | null, delta: string | null }>
  read: (id: string) => Promise<WorkflowMail | null>
  move: (message: WorkflowMail) => Promise<MailEffectOutcome<MailMoveReceipt>>
  send: (body: string, destination: { chatId: string, credential: string }) => Promise<MailEffectOutcome<{ messageId: number }>>
}
interface Item { reported?: boolean, message: WorkflowMail, disposition: 'pending' | 'excluded' | 'retain' | 'proposed' | 'archived' | 'notApplied' | 'unknown', reason: string, receipt?: MailMoveReceipt }
interface ReportPart { attempt?: number, body: string, messageId?: number, state: 'pending' | 'confirmed' | 'notApplied' | 'unknown', reason?: string }
interface Batch { phase: 'enumerating' | 'filtering' | 'reporting' | 'sealed' | 'notifying' | 'completed', baseline: boolean, cursor: string | null, items: Item[], report: ReportPart[], notification: ReportPart[], output?: MailFilterResult }
export interface MailWorkflowReview { batchId: string, mailbox: string, phase: string, baseline: boolean, items: Item[], report: ReportPart[], notification: ReportPart[] }

export class MailWorkflow {
  private readonly ledger: EffectLedger
  constructor(private readonly store: PodDatabase, private readonly batchId: string, private readonly podId: string, private readonly runId: string, private readonly configuration: MailWorkflowConfiguration, private readonly transport: WorkflowMailTransport, private readonly now: () => number = Date.now) { this.ledger = new EffectLedger(store) }

  private scopeId(): string {
    const workflowId = this.store.db.prepare('SELECT workflow_id FROM workflow_runs WHERE id=?').get(this.batchId)?.workflow_id
    if (!workflowId) throw new Error('Mail integration requires an owning workflow run')
    return digest(`${workflowId}:${this.configuration.mailbox.toLowerCase()}`)
  }

  private load(): Batch {
    this.transport.assertCurrent()
    if (this.store.db.prepare('SELECT restored FROM workflow_mail_scopes WHERE id=?').get(this.scopeId())?.restored === 1) throw new Error('Restored mail history requires a new workflow with a quiet baseline')
    const stored = this.store.db.prepare('SELECT state,configuration FROM workflow_mail_batches WHERE id=?').get(this.batchId)
    if (stored) {
      if (stored.configuration !== JSON.stringify(this.configuration)) throw new Error('Mail policy changed during the frozen batch')
      return JSON.parse(stored.state as string) as Batch
    }
    if (this.podId !== this.configuration.filterPodId) throw new Error('Filtering must complete before mail notification')
    return this.store.transaction(() => {
      const scope = this.scopeId()
      this.store.db.prepare('INSERT OR IGNORE INTO workflow_mail_scopes(id,mailbox,baseline_at) VALUES(?,?,?)').run(scope, this.configuration.mailbox, this.now())
      const state = this.store.db.prepare('SELECT * FROM workflow_mail_scopes WHERE id=?').get(scope)!
      const batch: Batch = { phase: 'enumerating', baseline: state.initialized === 0, cursor: state.cursor as string | null, items: [], report: [], notification: [] }
      this.store.db.prepare('INSERT INTO workflow_mail_batches VALUES(?,?,?,?)').run(this.batchId, scope, JSON.stringify(this.configuration), JSON.stringify(batch))
      return batch
    })
  }

  private save(batch: Batch): void {
    this.transport.assertCurrent()
    this.store.db.prepare('UPDATE workflow_mail_batches SET state=? WHERE id=?').run(JSON.stringify(batch), this.batchId)
  }

  review(): MailWorkflowReview {
    const batch = this.load()
    return { batchId: this.batchId, mailbox: this.configuration.mailbox, phase: batch.phase, baseline: batch.baseline, items: batch.items, report: batch.report, notification: batch.notification }
  }

  private audit(key: string, kind: string, body: unknown): void { this.store.db.prepare('INSERT INTO workflow_mail_audit(batch_id,effect_key,kind,body,at) VALUES(?,?,?,?,?)').run(this.batchId, key, kind, JSON.stringify(body), this.now()) }

  async filter(): Promise<{ complete: boolean, output?: MailFilterResult }> {
    if (this.podId !== this.configuration.filterPodId) throw new Error('Mail filtering belongs to the configured filter pod')
    const batch = this.load()
    if (batch.output) return { complete: true, output: batch.output }
    if (batch.phase === 'enumerating') { await this.enumerate(batch); return { complete: false } }
    if (batch.phase === 'filtering') await this.classifyAndMove(batch)
    if (batch.phase === 'reporting') await this.deliverReport(batch)
    if (batch.phase !== 'sealed') return { complete: false }
    const output: MailFilterResult = { schema: 'mail-filter-result/v1', batchId: this.batchId, mailbox: this.configuration.mailbox, baseline: batch.baseline, mode: this.configuration.mode, retained: batch.items.filter(item => ['retain', 'proposed'].includes(item.disposition)).map(item => item.message.id), archived: batch.items.filter(item => item.disposition === 'archived').map(item => item.message.id), reportReceipts: batch.report.flatMap(part => part.messageId ? [part.messageId] : []) }
    this.store.transaction(() => {
      batch.output = output; this.save(batch)
      if (this.configuration.mode === 'preview') return
      for (const item of batch.items.filter(item => item.disposition === 'archived')) {
        for (const id of [item.message.id, item.receipt!.afterId]) this.store.db.prepare('INSERT OR IGNORE INTO workflow_mail_processed VALUES(?,?)').run(this.scopeId(), id)
      }
      for (const item of batch.items.filter(item => item.disposition === 'archived')) this.store.db.prepare('DELETE FROM workflow_mail_pending WHERE scope_id=? AND message_id=?').run(this.scopeId(), item.message.id)
    })
    return { complete: true, output }
  }

  private async enumerate(batch: Batch): Promise<void> {
    const page = await this.transport.delta(batch.cursor); this.transport.assertCurrent()
    if ((page.next === null) === (page.delta === null) || page.items.length > 100 || page.removed.length > 100 || (page.next !== null && page.next === batch.cursor)) throw new Error('Mail enumeration is incomplete or has an invalid boundary')
    const scopeId = this.scopeId()
    this.store.transaction(() => {
      const scope = this.store.db.prepare('SELECT * FROM workflow_mail_scopes WHERE id=?').get(scopeId)!
      for (const raw of page.items) {
        const message = parseWorkflowMail(raw)
        if (message.conversation) {
          for (const address of [message.sender, ...message.participants]) this.store.db.prepare('INSERT OR IGNORE INTO workflow_mail_participants VALUES(?,?,?)').run(scopeId, message.conversation, address.toLowerCase())
        }
        if (batch.baseline && message.receivedAt < (scope.baseline_at as number)) this.store.db.prepare('INSERT OR IGNORE INTO workflow_mail_processed VALUES(?,?)').run(scopeId, message.id)
        if (!this.store.db.prepare('SELECT 1 FROM workflow_mail_processed WHERE scope_id=? AND message_id=?').get(scopeId, message.id) && (!batch.baseline || message.receivedAt >= (scope.baseline_at as number))) this.store.db.prepare('INSERT INTO workflow_mail_pending VALUES(?,?,?) ON CONFLICT(scope_id,message_id) DO UPDATE SET body=excluded.body').run(scopeId, message.id, JSON.stringify(message))
      }
      for (const id of page.removed) this.store.db.prepare('DELETE FROM workflow_mail_pending WHERE scope_id=? AND message_id=?').run(scopeId, id)
      if ((this.store.db.prepare('SELECT count(*) AS count FROM workflow_mail_pending WHERE scope_id=?').get(scopeId)!.count as number) > 5000) throw new Error('Mail backlog exceeds the pilot limit; review before continuing')
      batch.cursor = page.next ?? page.delta
      if (page.delta) {
        this.store.db.prepare('UPDATE workflow_mail_scopes SET cursor=?,initialized=1 WHERE id=?').run(page.delta, scopeId)
        if (batch.baseline) {
          batch.phase = 'sealed'
        }
        else {
          batch.items = this.store.db.prepare('SELECT body FROM workflow_mail_pending WHERE scope_id=? ORDER BY json_extract(body,\'$.receivedAt\'),message_id LIMIT 100').all(scopeId).map(row => ({ message: JSON.parse(row.body as string), disposition: 'pending', reason: '' }))
          batch.phase = 'filtering'
        }
      }
      this.save(batch)
    })
  }

  private async effect<T>(key: string, operation: string, input: unknown, execute: () => Promise<MailEffectOutcome<T>>): Promise<MailEffectOutcome<T>> {
    this.transport.assertCurrent()
    const admission = this.store.transaction(() => {
      const effect = this.ledger.begin(this.podId, this.runId, key, operation, input)
      if (effect.execute) this.audit(key, 'intent', input)
      return effect
    })
    if (!admission.execute) return admission.result as MailEffectOutcome<T>
    let result: MailEffectOutcome<T>
    try { result = await execute() }
    catch (error) { result = { state: 'unknown', reason: error instanceof Error ? error.message : 'Transport stopped after dispatch' } }
    this.store.transaction(() => {
      if (result.state === 'unknown') this.ledger.markUnknown(this.podId, key)
      else this.ledger.complete(this.podId, key, result)
      this.audit(key, result.state, result)
    })
    this.transport.assertCurrent()
    return result
  }

  private async classifyAndMove(batch: Batch): Promise<void> {
    let examined = 0
    for (const item of batch.items) {
      if (item.disposition !== 'pending') continue
      if (++examined > 20) break
      const participants = this.store.db.prepare('SELECT address FROM workflow_mail_participants WHERE scope_id=? AND conversation=?').all(this.scopeId(), item.message.conversation).map(row => row.address as string)
      const protectedConversation = protectedPartner({ ...item.message, participants }, this.configuration)
      const decision = classifyMail(item.message, this.configuration, protectedConversation)
      item.reason = decision.reason
      if (decision.disposition === 'retain') { item.disposition = 'retain'; this.save(batch); continue }
      if (this.configuration.mode === 'preview') { item.disposition = 'proposed'; this.save(batch); continue }
      if (!this.transport.conditionalMoveVerified) throw new Error('Automatic archiving is blocked until conditional move support is verified')
      const key = `mail:${this.batchId}:move:${digest(item.message.id).slice(0, 32)}`
      const previous = this.store.db.prepare('SELECT state,result FROM effect_ledger WHERE pod_id=? AND effect_key=?').get(this.podId, key)
      let result: MailEffectOutcome<MailMoveReceipt>
      if (previous?.state === 'completed') {
        result = JSON.parse(previous.result as string)
      }
      else if (previous) {
        result = { state: 'unknown', reason: 'Previous move needs reconciliation; finding a message in Archive does not prove this attempt moved it' }
      }
      else {
        const current = await this.transport.read(item.message.id); this.transport.assertCurrent()
        if (!current || current.version !== item.message.version || current.folder !== item.message.folder || current.id !== item.message.id) {
          item.disposition = 'excluded'; item.reason = 'Message changed or owner moved it; no move attempted'
          this.store.transaction(() => {
            if (current && current.id === item.message.id && current.folder === item.message.folder) this.store.db.prepare('UPDATE workflow_mail_pending SET body=? WHERE scope_id=? AND message_id=?').run(JSON.stringify(current), this.scopeId(), item.message.id)
            else this.store.db.prepare('DELETE FROM workflow_mail_pending WHERE scope_id=? AND message_id=?').run(this.scopeId(), item.message.id)
            this.save(batch)
          })
          continue
        }
        this.save(batch)
        result = await this.effect(key, 'mail.move', { mailbox: this.configuration.mailbox, id: current.id, version: current.version, folder: current.folder, destination: 'archive', sender: current.sender, subject: current.subject, reason: item.reason }, () => this.transport.move(current))
      }
      if (result.state === 'confirmed') { item.disposition = 'archived'; item.receipt = result.receipt }
      else { item.disposition = result.state; item.reason = result.reason }
      this.save(batch)
      if (result.state !== 'confirmed') break
    }
    if (batch.items.some(item => item.disposition === 'pending') && !batch.items.some(item => ['unknown', 'notApplied'].includes(item.disposition))) return
    batch.phase = 'reporting'
    if (this.configuration.mode !== 'preview') {
      const unreported = batch.items.filter(item => !item.reported && ['archived', 'notApplied', 'unknown'].includes(item.disposition))
      batch.report.push(...reportParts(unreported))
      for (const item of unreported) item.reported = true
    }
    this.save(batch)
  }

  private async deliver(parts: ReportPart[], batch: Batch, kind: 'archive-report' | 'notification'): Promise<void> {
    for (const [index, part] of parts.entries()) {
      if (part.state === 'confirmed') continue
      if (part.state !== 'pending') throw new Error('Telegram delivery needs owner reconciliation before retrying')
      const destination = { chatId: this.configuration.telegramChatId, credential: this.configuration.telegramCredential }
      const key = `mail:${this.batchId}:${kind}:${index}:${part.attempt ?? 0}`
      const result = await this.effect(key, 'mail.telegram', { body: part.body, ...destination }, () => this.transport.send(part.body, destination))
      part.state = result.state
      if (result.state === 'confirmed') part.messageId = result.receipt.messageId
      else part.reason = result.reason
      this.save(batch)
      if (result.state !== 'confirmed') throw new Error('Telegram delivery needs owner reconciliation before retrying')
    }
  }

  private async deliverReport(batch: Batch): Promise<void> {
    await this.deliver(batch.report, batch, 'archive-report')
    if (batch.items.some(item => ['unknown', 'notApplied', 'pending'].includes(item.disposition))) throw new Error('Mail filtering has unresolved moves; the successor remains blocked')
    batch.phase = 'sealed'; this.save(batch)
  }

  remaining(offset = 0): { baseline: boolean, complete: boolean, messages: { id: string, sender: string, subject: string, body: string }[] } {
    if (this.podId !== this.configuration.notifyPodId) throw new Error('Mail notification belongs to the configured successor pod')
    const batch = this.load()
    if (!batch.output) throw new Error('Filtering must complete before mail notification')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100) throw new Error('Invalid mail batch cursor')
    const retained = batch.items.filter(item => batch.output!.retained.includes(item.message.id))
    return { baseline: batch.baseline, complete: offset + 20 >= retained.length, messages: retained.slice(offset, offset + 20).map(({ message }) => ({ id: message.id, sender: message.sender, subject: message.subject.slice(0, 500), body: message.body.slice(0, 3000) })) }
  }

  async notify(summary: string): Promise<void> {
    this.remaining()
    const batch = this.load()
    if (batch.phase === 'completed') return
    if (typeof summary !== 'string' || !summary.trim() || summary.length > 32000) throw new Error('Invalid important mail summary')
    if (!batch.notification.length) {
      batch.notification = batch.baseline || !batch.output!.retained.length || this.configuration.mode === 'preview' ? [] : splitText(summary).map(body => ({ body, state: 'pending' }))
      batch.phase = 'notifying'; this.save(batch)
    }
    await this.deliver(batch.notification, batch, 'notification')
    this.store.transaction(() => {
      batch.phase = 'completed'; this.save(batch)
      if (this.configuration.mode === 'archive') {
        for (const id of batch.output!.retained) {
          this.store.db.prepare('INSERT OR IGNORE INTO workflow_mail_processed VALUES(?,?)').run(this.scopeId(), id)
          this.store.db.prepare('DELETE FROM workflow_mail_pending WHERE scope_id=? AND message_id=?').run(this.scopeId(), id)
        }
      }
    })
  }
}

function splitText(body: string): string[] {
  const parts: string[] = []
  for (let offset = 0; offset < body.length; offset += 3500) parts.push(body.slice(offset, offset + 3500))
  return parts
}
function reportParts(items: Item[]): ReportPart[] {
  const lines = items.filter(item => ['archived', 'notApplied', 'unknown'].includes(item.disposition)).map(item => `${item.disposition === 'archived' ? 'ARCHIVED' : item.disposition === 'unknown' ? 'UNKNOWN — NOT CONFIRMED' : 'FAILED — NOT MOVED'}\n${item.message.sender.replace(/[\r\n]/g, ' ').slice(0, 320)} · ${item.message.subject.replace(/[\r\n]/g, ' ').slice(0, 500)}\n${item.reason.slice(0, 400)}${item.receipt ? `\nReceipt: ${item.receipt.requestId.slice(0, 200)}` : ''}`)
  const parts: ReportPart[] = []; let body = ''
  for (const line of lines) {
    if (body && body.length + line.length + 2 > 3500) { parts.push({ body, state: 'pending' }); body = '' }
    body += `${body ? '\n\n' : ''}${line}`
  }
  if (body) parts.push({ body, state: 'pending' })
  return parts
}

export function reviewMailBatch(store: PodDatabase, batchId: string): MailBatchReview | null {
  const row = store.db.prepare('SELECT configuration,state FROM workflow_mail_batches WHERE id=?').get(batchId)
  if (!row) return null
  const batch = JSON.parse(row.state as string) as Batch
  const configuration = JSON.parse(row.configuration as string) as MailWorkflowConfiguration
  return { batchId, mailbox: configuration.mailbox, phase: batch.phase, baseline: batch.baseline,
    items: batch.items.map(item => ({ id: item.message.id, sender: item.message.sender, subject: item.message.subject, disposition: item.disposition, reason: item.reason, ...(item.receipt ? { receipt: item.receipt } : {}) })),
    deliveries: [...batch.report.map((part, index) => ({ ...part, key: `mail:${batchId}:archive-report:${index}:${part.attempt ?? 0}` })), ...batch.notification.map((part, index) => ({ ...part, key: `mail:${batchId}:notification:${index}:${part.attempt ?? 0}` }))],
    effects: store.db.prepare('SELECT e.effect_key AS key,e.operation,e.run_id AS runId,e.pod_id AS podId,CASE WHEN e.state=\'completed\' AND json_extract(e.result,\'$.state\')=\'notApplied\' AND NOT EXISTS(SELECT 1 FROM workflow_mail_audit m WHERE m.batch_id=a.workflow_run_id AND m.effect_key=e.effect_key AND m.kind=\'owner-reconciliation\') THEN \'notApplied\' ELSE e.state END AS state FROM effect_ledger e JOIN workflow_attempts a ON a.run_id=e.run_id WHERE a.workflow_run_id=? AND e.operation IN (\'mail.move\',\'mail.telegram\')').all(batchId) as unknown as MailBatchReview['effects'],
  }
}

export function reconcileMailEffect(store: PodDatabase, resolution: MailEffectResolution): void {
  store.transaction(() => {
    const effect = store.db.prepare('SELECT e.* FROM effect_ledger e JOIN workflow_attempts a ON a.run_id=e.run_id WHERE a.workflow_run_id=? AND e.effect_key=? AND e.operation IN (\'mail.move\',\'mail.telegram\')').get(resolution.batchId, resolution.key)
    if (!effect || store.db.prepare('SELECT 1 FROM runs WHERE pod_id=? AND state=\'running\'').get(effect.pod_id as string)) throw new Error('Stop and inspect the owning run before reconciling mail effects')
    if (effect.state !== 'unknown' && !(effect.state === 'completed' && JSON.parse(effect.result as string).state === 'notApplied')) throw new Error('Mail effect is not awaiting owner reconciliation')
    const row = store.db.prepare('SELECT state FROM workflow_mail_batches WHERE id=?').get(resolution.batchId)!
    const batch = JSON.parse(row.state as string) as Batch
    let result: MailEffectOutcome<MailMoveReceipt | { messageId: number }>
    if (effect.operation === 'mail.move') {
      const item = batch.items.find(item => resolution.key === `mail:${resolution.batchId}:move:${digest(item.message.id).slice(0, 32)}`)
      if (!item || !['pending', 'notApplied', 'unknown'].includes(item.disposition)) throw new Error('Mail effect does not belong to this frozen batch')
      if (resolution.outcome === 'confirmed') {
        if (!resolution.move || resolution.move.beforeId !== item.message.id || resolution.move.folder === item.message.folder) throw new Error('A confirmed move requires its complete provider receipt')
        result = { state: 'confirmed', receipt: resolution.move }; item.disposition = 'archived'; item.receipt = resolution.move; item.reason = 'Move confirmed by owner with provider evidence'
        batch.report.push(...reportParts([item])); item.reported = true
      }
      else { result = { state: 'notApplied', reason: resolution.evidence }; item.disposition = 'retain'; item.reason = 'Owner confirmed no move; keep in inbox' }
      batch.phase = 'filtering'
    }
    else {
      const candidates = [...batch.report.map((part, index) => ({ part, key: `mail:${resolution.batchId}:archive-report:${index}:${part.attempt ?? 0}` })), ...batch.notification.map((part, index) => ({ part, key: `mail:${resolution.batchId}:notification:${index}:${part.attempt ?? 0}` }))]
      const part = candidates.find(item => item.key === resolution.key)?.part
      if (!part) throw new Error('Mail delivery does not belong to this frozen outbox')
      if (resolution.outcome === 'confirmed') {
        if (!resolution.messageId) throw new Error('Record the confirmed Telegram message identifier')
        result = { state: 'confirmed', receipt: { messageId: resolution.messageId } }; part.state = 'confirmed'; part.messageId = resolution.messageId; delete part.reason
      }
      else { result = { state: 'notApplied', reason: resolution.evidence }; part.state = 'pending'; part.attempt = (part.attempt ?? 0) + 1; delete part.reason }
    }
    if (effect.state === 'unknown') new EffectLedger(store).reconcile(effect.pod_id as string, resolution.key, { applied: true, result })
    store.db.prepare('UPDATE workflow_mail_batches SET state=? WHERE id=?').run(JSON.stringify(batch), resolution.batchId)
    store.db.prepare('INSERT INTO workflow_mail_audit(batch_id,effect_key,kind,body,at) VALUES(?,?,\'owner-reconciliation\',?,?)').run(resolution.batchId, resolution.key, JSON.stringify(resolution), Date.now())
  })
}
