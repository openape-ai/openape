import { parseDomainCommand } from '../../contracts/domain-admin'
import type { DomainOverview } from '../../contracts/domain-admin'
import { ownerWriter } from '../../contracts/domain-data'
import type { PodDatabase } from '../storage/database'
import type { Approvals } from './approvals'
import type { DomainData } from './domain'
import type { OwnerQuestions } from './questions'
import type { WorkLedger } from './work'

export interface DomainServices { data: DomainData, work: WorkLedger, questions: OwnerQuestions, approvals: Approvals }

/** Owner administration of shared domain data (contracts/domain-admin.ts); every command acts as the owner. */
export class DomainAdministration {
  constructor(private readonly store: PodDatabase, private readonly services: DomainServices) {}

  execute(input: unknown): unknown {
    const command = parseDomainCommand(input)
    const { data, work, questions, approvals } = this.services
    switch (command.type) {
      case 'list': return this.overview()
      case 'define': return data.define(command)
      case 'setReaders': return data.setReaders(command.path, command.readers, command.revision)
      case 'assignWriter': return data.assignWriter(command.path, command.writer, command.revision)
      case 'entries': return data.list(ownerWriter, command.path, { cursor: command.cursor ?? null })
      case 'set': return data.set(ownerWriter, command.key, command.value, command.revision)
      case 'delete': return data.set(ownerWriter, command.key, null, command.revision, true)
      case 'work': return { counts: work.counts(command.operation)[command.operation] ?? null, items: work.items(command.operation, command.states) }
      case 'reprocess': work.reprocess(command.operation); return this.overview()
      case 'selectRule': work.selectRule(command.operation, command.ruleVersion); return this.overview()
      case 'release': work.release(command.key, command.evidence); return this.overview()
      case 'answer': return questions.answer(command.questionId, command.option)
      case 'resolveApproval': approvals.resolve(command.id, command.decision, command.evidence); return this.overview()
      case 'resolveEffect': this.resolveEffect(command.actionKey, command.attempt, command.applied, command.evidence); return this.overview()
      case 'openApproval': throw new Error('Opening an approval page needs the desktop window')
    }
  }

  overview(): DomainOverview {
    const { data, work, questions, approvals } = this.services
    const operations = this.store.db.prepare('SELECT operation,input,output,rule_version,generation FROM work_operations ORDER BY operation').all()
    const effects = this.store.db.prepare(`SELECT a.action_key,a.attempt,a.pod_id,a.run_id,a.operation,a.created_at,r.body FROM effect_attempts a
      LEFT JOIN effect_receipts r ON r.action_key=a.action_key AND r.attempt=a.attempt AND r.outcome='intent' WHERE a.state='unknown' ORDER BY a.created_at`).all()
    return {
      namespaces: data.namespaces(),
      operations: operations.map(row => ({ operation: String(row.operation), input: String(row.input), output: String(row.output), ruleVersion: Number(row.rule_version), generation: Number(row.generation), counts: work.counts(String(row.operation))[String(row.operation)] ?? null })),
      questions: questions.pending(100).map(({ id, podId, namespace, key, title, body, options, data, createdAt }) => ({ id, podId, namespace, key, title, body, options, data, createdAt })),
      approvals: approvals.views(),
      held: operations.flatMap(row => work.items(String(row.operation), ['blocked', 'unknown'], 100)),
      unknownEffects: effects.map(row => ({ actionKey: String(row.action_key), attempt: Number(row.attempt), podId: String(row.pod_id), runId: row.run_id === null ? null : String(row.run_id), operation: String(row.operation), createdAt: Number(row.created_at), intent: row.body ? JSON.parse(String(row.body)) as unknown : null })),
    }
  }

  /** Records what the owner observed about an uncertain effect; it never executes the effect again. */
  private resolveEffect(actionKey: string, attempt: number, applied: boolean, evidence: string): void {
    this.store.transaction(() => {
      const state = applied ? 'confirmed_applied' : 'confirmed_not_applied'
      if (this.store.db.prepare('UPDATE effect_attempts SET state=? WHERE action_key=? AND attempt=? AND state=\'unknown\'').run(state, actionKey, attempt).changes !== 1) throw new Error('Only an uncertain effect can be reconciled')
      const sequence = Number(this.store.db.prepare('SELECT coalesce(max(sequence),0) AS sequence FROM effect_receipts WHERE action_key=? AND attempt=?').get(actionKey, attempt)!.sequence) + 1
      this.store.db.prepare('INSERT INTO effect_receipts VALUES(?,?,?,?,?,?)').run(actionKey, attempt, sequence, state, JSON.stringify({ reconciledBy: ownerWriter, evidence: evidence.slice(0, 2000) }), Date.now())
    })
  }
}
