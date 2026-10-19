import { parseDomainCommand } from '../../contracts/domain-admin'
import type { DomainOverview } from '../../contracts/domain-admin'
import { ownerWriter } from '../../contracts/domain-data'
import type { PodDatabase } from '../storage/database'
import type { ApprovalHistory } from './approval-history'
import type { DomainData } from './domain'
import type { OwnerQuestions } from './questions'
import type { WorkLedger } from './work'

export interface DomainServices { data: DomainData, work: WorkLedger, questions: OwnerQuestions, approvals: ApprovalHistory }

/** Owner administration of shared domain data (contracts/domain-admin.ts); every command acts as the owner. */
export class DomainAdministration {
  constructor(private readonly store: PodDatabase, private readonly services: DomainServices) {}

  execute(input: unknown): unknown {
    const command = parseDomainCommand(input)
    const { data, work, questions } = this.services
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
      case 'resolveApproval': throw new Error('Historical decisions cannot be renewed in Pods; reconcile the external tool journal')
      case 'openApproval': throw new Error('Opening an approval page needs the desktop window')
    }
  }

  overview(): DomainOverview {
    const { data, work, questions, approvals } = this.services
    const operations = this.store.db.prepare('SELECT operation,input,output,rule_version,generation FROM work_operations ORDER BY operation').all()
    return {
      namespaces: data.namespaces(),
      operations: operations.map(row => ({ operation: String(row.operation), input: String(row.input), output: String(row.output), ruleVersion: Number(row.rule_version), generation: Number(row.generation), counts: work.counts(String(row.operation))[String(row.operation)] ?? null })),
      questions: questions.pending(100).map(({ id, podId, namespace, key, title, body, options, data, createdAt }) => ({ id, podId, namespace, key, title, body, options, data, createdAt })),
      approvals: approvals.views(),
      held: operations.flatMap(row => work.items(String(row.operation), ['blocked', 'unknown'], 100)),
    }
  }

}
