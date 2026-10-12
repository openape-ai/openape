import { canonicalNetworkJson as canonicalJson } from '../../contracts/network-json'
import { parseWorkDeclarations } from '../../contracts/work'
import type { ScriptManifest } from '../storage/database'
import type { DataPrincipal, DomainData  } from './domain'
import type { OwnerQuestions } from './questions'
import type { WorkLedger } from './work'

/** Script operations on shared data, work and owner questions (issue 1465). */
export const dataOperations = new Set(['work.contract', 'data.get', 'data.set', 'data.delete', 'data.list', 'work.find', 'work.claim', 'work.complete', 'work.defer', 'work.fail', 'decisions.ask'])

export function fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid operation payload')
  const input = value as Record<string, unknown>
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => ![...required, ...optional].includes(key))) throw new Error(`Operation payload accepts ${[...required, ...optional].join(', ')}`)
  return input
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${name}`)
  return value
}
const count = (value: unknown): number | undefined => value === undefined ? undefined : Number(value)

export function handleDataOperation(services: { data: DomainData, work: WorkLedger, questions: OwnerQuestions }, operation: string, payload: unknown, principal: { podId: string, runId: string }, manifest: ScriptManifest): unknown {
  const actor: DataPrincipal = principal
  switch (operation) {
    case 'work.contract':
      if (!manifest.work || canonicalJson(parseWorkDeclarations(payload)) !== canonicalJson(manifest.work)) throw new Error('Script work declaration changed since validation')
      return true
    case 'data.get': return services.data.get(actor, text(fields(payload, ['key']).key, 'data key'))
    case 'data.set': {
      const input = fields(payload, ['key', 'value', 'expectedRevision'])
      return services.data.set(actor, text(input.key, 'data key'), input.value, Number(input.expectedRevision))
    }
    case 'data.delete': {
      const input = fields(payload, ['key', 'expectedRevision'])
      return services.data.set(actor, text(input.key, 'data key'), null, Number(input.expectedRevision), true)
    }
    case 'data.list': {
      const input = fields(payload, ['prefix'], ['cursor', 'limit'])
      return services.data.list(actor, text(input.prefix, 'data prefix'), { cursor: input.cursor as string | null | undefined, limit: count(input.limit) })
    }
    case 'work.find': {
      const input = fields(payload, ['operation'], ['limit'])
      return services.work.find(principal, { operation: text(input.operation, 'work operation'), limit: count(input.limit) })
    }
    case 'work.claim': {
      const input = fields(payload, ['key'], ['expectedInputFingerprint'])
      return services.work.claim(principal, { key: text(input.key, 'work key'), expectedInputFingerprint: input.expectedInputFingerprint === undefined ? undefined : text(input.expectedInputFingerprint, 'fingerprint') })
    }
    case 'work.complete': {
      const input = fields(payload, ['claimToken', 'result'], ['artifacts'])
      if (input.artifacts !== undefined && !Array.isArray(input.artifacts)) throw new Error('Invalid result artifacts')
      return services.work.complete(principal, { claimToken: text(input.claimToken, 'claim'), result: input.result, artifacts: input.artifacts as string[] | undefined })
    }
    case 'work.defer': {
      const input = fields(payload, ['claimToken', 'reason'], ['until'])
      services.work.defer(principal, { claimToken: text(input.claimToken, 'claim'), reason: text(input.reason, 'reason'), until: count(input.until) })
      return { state: 'waiting' }
    }
    case 'work.fail': {
      const input = fields(payload, ['claimToken', 'reason'], ['retryable'])
      return { state: services.work.fail(principal, { claimToken: text(input.claimToken, 'claim'), reason: text(input.reason, 'reason'), retryable: input.retryable === true }) }
    }
    case 'decisions.ask': return services.questions.ask(principal, payload)
  }
  throw new Error('Unsupported data operation')
}
