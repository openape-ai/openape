import { dataFields, dataRevision } from './network-data'
import { workflowIdentity } from './workflow-ports'
import { parseNetworkCommand, parseNetworkDefinition } from './networks'
import type { NetworkDefinition, NetworkDraft } from './networks'

export interface ReplacementPreview {
  fingerprint: string
  current: NetworkDefinition
  candidate: NetworkDefinition | null
  draft: NetworkDraft
  issues: string[]
  added: string[]
  retired: string[]
}
export type ReplacementCommand =
  | { type: 'replacementSetup', id: string, revision: number }
  | { type: 'replacementPreview', id: string, revision: number, draft: NetworkDraft }
  | { type: 'replaceComposition', id: string, revision: number, draft: NetworkDraft, expectedFingerprint: string }

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid composition review digest')
  return value
}
function draft(value: unknown): NetworkDraft {
  const command = parseNetworkCommand({ type: 'create', draft: value })
  if (command.type !== 'create') throw new Error('Invalid composition draft')
  return command.draft
}
export function parseReplacementCommand(value: unknown): ReplacementCommand {
  const input = dataFields(value, ['type', 'id', 'revision'], ['draft', 'expectedFingerprint'])
  const id = workflowIdentity(input.id); const revision = dataRevision(input.revision)
  if (!revision) throw new Error('Invalid network revision')
  if (input.type === 'replacementSetup') { dataFields(input, ['type', 'id', 'revision']); return { type: 'replacementSetup', id, revision } }
  if (input.type === 'replacementPreview') { dataFields(input, ['type', 'id', 'revision', 'draft']); return { type: 'replacementPreview', id, revision, draft: draft(input.draft) } }
  if (input.type !== 'replaceComposition') throw new Error('Invalid composition replacement command')
  dataFields(input, ['type', 'id', 'revision', 'draft', 'expectedFingerprint'])
  return { type: 'replaceComposition', id, revision, draft: draft(input.draft), expectedFingerprint: hash(input.expectedFingerprint) }
}
export function parseReplacementPreview(value: unknown): ReplacementPreview {
  const input = dataFields(value, ['fingerprint', 'current', 'candidate', 'draft', 'issues', 'added', 'retired'])
  hash(input.fingerprint); parseNetworkDefinition(input.current); draft(input.draft)
  if (input.candidate !== null) parseNetworkDefinition(input.candidate)
  if (!Array.isArray(input.issues) || input.issues.length > 128 || input.issues.some(item => typeof item !== 'string' || item.length > 4000)) throw new Error('Invalid composition review issues')
  for (const key of ['added', 'retired'] as const) {
    if (!Array.isArray(input[key]) || input[key].length > 64) throw new Error('Invalid composition member changes')
    for (const id of input[key]) workflowIdentity(id)
  }
  return input as unknown as ReplacementPreview
}
