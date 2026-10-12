import type { ApprovalView } from './approvals'
import type { DataMode, RecordSchema } from './domain-data'
import { dataFields, plainObject } from './fields'
import { workStates } from './work'
import type { WorkState } from './work'

/**
 * Owner administration of shared domain data (issue 1465): namespaces and their writer and readers, owner records,
 * declared work, owner questions, object approvals and uncertain external effects. Every command acts as the owner.
 */
export type DomainCommand =
  | { type: 'list' }
  | { type: 'define', path: string, writer: string, mode: 'records' | 'results', readers: string[], schema?: unknown }
  | { type: 'setReaders', path: string, readers: string[], revision: number }
  | { type: 'assignWriter', path: string, writer: string, revision: number }
  | { type: 'entries', path: string, cursor?: string | null }
  | { type: 'set', key: string, value: unknown, revision: number }
  | { type: 'delete', key: string, revision: number }
  | { type: 'work', operation: string, states?: WorkState[] }
  | { type: 'reprocess', operation: string }
  | { type: 'release', key: string, evidence: string }
  | { type: 'answer', questionId: string, option: string }
  | { type: 'resolveApproval', id: string, decision: 'renew' | 'withdraw', evidence: string }
  | { type: 'resolveEffect', actionKey: string, attempt: number, applied: boolean, evidence: string }
  /** Desktop only: opens the IdP page of a requested approval in the owner's browser; the owner decides there. */
  | { type: 'openApproval', id: string }

export interface DomainNamespaceView { path: string, writer: string, mode: DataMode, schema: RecordSchema | null, readers: string[], revision: number, writerEpoch: number, entries: number }
export interface DomainQuestionView { id: string, podId: string, namespace: string, key: string, title: string, body: string, options: { key: string, title: string }[], data: Record<string, unknown>, createdAt: number }
export interface DomainWorkItemView { key: string, operation: string, object: string, state: WorkState, attempt: number, readyAt: number, reason: string | null, inputRevision: number }
export interface DomainEffectView { actionKey: string, attempt: number, podId: string, runId: string | null, operation: string, createdAt: number, intent: unknown }
/** What the owner settles: open questions, approvals at or after the IdP, held work and uncertain effects. */
export interface DomainOverview {
  namespaces: DomainNamespaceView[]
  operations: { operation: string, input: string, output: string, ruleVersion: number, generation: number, counts: Record<WorkState, number> | null }[]
  questions: DomainQuestionView[]
  approvals: (ApprovalView & { podId: string })[]
  held: DomainWorkItemView[]
  unknownEffects: DomainEffectView[]
}

const shapes: Record<DomainCommand['type'], [string[], string[]]> = {
  list: [[], []],
  define: [['path', 'writer', 'mode', 'readers'], ['schema']],
  setReaders: [['path', 'readers', 'revision'], []],
  assignWriter: [['path', 'writer', 'revision'], []],
  entries: [['path'], ['cursor']],
  set: [['key', 'value', 'revision'], []],
  delete: [['key', 'revision'], []],
  work: [['operation'], ['states']],
  reprocess: [['operation'], []],
  release: [['key', 'evidence'], []],
  answer: [['questionId', 'option'], []],
  resolveApproval: [['id', 'decision', 'evidence'], []],
  resolveEffect: [['actionKey', 'attempt', 'applied', 'evidence'], []],
  openApproval: [['id'], []],
}

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export function parseDomainCommand(input: unknown): DomainCommand {
  const type = plainObject(input).type
  if (typeof type !== 'string' || !Object.hasOwn(shapes, type)) throw new Error('Invalid domain data command')
  const [required, optional] = shapes[type as DomainCommand['type']]
  const value = dataFields(input, ['type', ...required], optional)
  for (const key of ['path', 'writer', 'key', 'operation', 'questionId', 'option', 'id']) {
    if (key in value && !text(value[key], 600)) throw new Error(`Invalid domain data ${key}`)
  }
  for (const key of ['revision', 'attempt']) {
    if (key in value && !revision(value[key])) throw new Error(`Invalid domain data ${key}`)
  }
  if ('evidence' in value && !text(value.evidence, 2000)) throw new Error('Reconciliation needs the owner\'s observation')
  if ('readers' in value && (!Array.isArray(value.readers) || value.readers.length > 64 || value.readers.some(reader => typeof reader !== 'string'))) throw new Error('Invalid domain data readers')
  if ('mode' in value && !['records', 'results'].includes(String(value.mode))) throw new Error('Invalid domain data mode')
  if ('decision' in value && !['renew', 'withdraw'].includes(String(value.decision))) throw new Error('Invalid approval decision')
  if ('applied' in value && typeof value.applied !== 'boolean') throw new Error('Invalid effect outcome')
  if ('cursor' in value && value.cursor !== null && typeof value.cursor !== 'string') throw new Error('Invalid domain data cursor')
  if ('states' in value && (!Array.isArray(value.states) || value.states.some(state => !workStates.includes(state as WorkState)))) throw new Error('Invalid work states')
  if ('actionKey' in value && (typeof value.actionKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.actionKey))) throw new Error('Invalid effect key')
  return structuredClone(value) as unknown as DomainCommand
}

export const domainHelp = {
  usage: 'Use action=domain with command. Pods never call each other: a Pod declares work on an input namespace it reads (script.work) and writes its results to the namespace it is the writer of. Reads (list, entries, work) need no requestId; every write needs a stable requestId.',
  commands: [
    '{type:list} → namespaces (path, writer, mode, readers, revision, entries), operations with work counts, pending owner questions, approvals and uncertain effects',
    '{type:define,path,writer:<podId>|owner,mode:records|results,readers:[podId],schema?:{required,types}} — a namespace never contains or lies inside another; results are written only by a Pod',
    '{type:setReaders,path,readers,revision} | {type:assignWriter,path,writer,revision} — a writer change fences the former writer',
    '{type:entries,path,cursor?} reads one page; {type:set,key:<namespace>/<record>,value,revision} and {type:delete,key,revision} write owner records (owner namespaces only)',
    '{type:work,operation,states?} lists work items; {type:reprocess,operation} reevaluates every object once more; {type:release,key,evidence} releases blocked or unknown work after the owner reconciled it',
    '{type:answer,questionId,option} answers an owner question',
    '{type:resolveApproval,id,decision:renew|withdraw,evidence} settles an uncertain approval; it never approves anything',
    '{type:resolveEffect,actionKey,attempt,applied,evidence} records what the owner observed about an uncertain external effect; it never executes the effect again',
  ],
}
