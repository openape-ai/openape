import { dataFields, dataRevision } from './network-data'
import { workflowIdentity } from './workflow-ports'

export interface ArchivePreview { fingerprint: string, issues: string[], members: number, retainedDeliveries: number }
export interface LegacyItemsPage {
  workflowId: string | null
  items: { itemId: string, podId: string, key: string, payload: string | null, truncated: boolean, originalHash: string, currentHash: string | null, state: string }[]
  after: number | null
}
export type RetirementCommand =
  | { type: 'archivePreview', id: string, revision: number }
  | { type: 'archiveNetwork', id: string, revision: number, expectedFingerprint: string }
  | { type: 'legacyItems', id: string, revision: number, after: number | null }

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid network retirement digest')
  return value
}

export function parseRetirementCommand(value: unknown): RetirementCommand {
  const input = dataFields(value, ['type', 'id', 'revision'], ['expectedFingerprint', 'after'])
  const id = workflowIdentity(input.id); const revision = dataRevision(input.revision)
  if (!revision) throw new Error('Invalid network revision')
  if (input.type === 'archivePreview') { dataFields(input, ['type', 'id', 'revision']); return { type: 'archivePreview', id, revision } }
  if (input.type === 'archiveNetwork') { dataFields(input, ['type', 'id', 'revision', 'expectedFingerprint']); return { type: 'archiveNetwork', id, revision, expectedFingerprint: hash(input.expectedFingerprint) } }
  if (input.type !== 'legacyItems') throw new Error('Invalid network retirement command')
  dataFields(input, ['type', 'id', 'revision', 'after'])
  return { type: 'legacyItems', id, revision, after: input.after === null ? null : dataRevision(input.after) }
}

export function parseArchivePreview(value: unknown): ArchivePreview {
  const input = dataFields(value, ['fingerprint', 'issues', 'members', 'retainedDeliveries'])
  hash(input.fingerprint); dataRevision(input.members); dataRevision(input.retainedDeliveries)
  if (!Array.isArray(input.issues) || input.issues.length > 64 || input.issues.some(issue => typeof issue !== 'string' || issue.length > 2000)) throw new Error('Invalid archive review')
  return input as unknown as ArchivePreview
}

export function parseLegacyItemsPage(value: unknown): LegacyItemsPage {
  const input = dataFields(value, ['workflowId', 'items', 'after'])
  if (input.workflowId !== null) workflowIdentity(input.workflowId)
  if (input.after !== null) dataRevision(input.after)
  if (!Array.isArray(input.items) || input.items.length > 5) throw new Error('Invalid retained item page')
  for (const value of input.items) {
    const item = dataFields(value, ['itemId', 'podId', 'key', 'payload', 'truncated', 'originalHash', 'currentHash', 'state'])
    workflowIdentity(item.itemId); workflowIdentity(item.podId); hash(item.originalHash)
    if (item.currentHash !== null) hash(item.currentHash)
    if (typeof item.key !== 'string' || item.key.length > 2000 || typeof item.state !== 'string' || item.state.length > 100 || typeof item.truncated !== 'boolean' || (item.payload !== null && (typeof item.payload !== 'string' || item.payload.length > 16384))) throw new Error('Invalid retained item')
  }
  return input as unknown as LegacyItemsPage
}
