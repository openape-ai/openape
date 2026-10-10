import { dataFields, dataIdentity, dataRevision } from './network-data'

export interface ArchivePreview { fingerprint: string, issues: string[], members: number }
export type RetirementCommand =
  | { type: 'archivePreview', id: string, revision: number }
  | { type: 'archiveNetwork', id: string, revision: number, expectedFingerprint: string }

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid network retirement digest')
  return value
}

export function parseRetirementCommand(value: unknown): RetirementCommand {
  const input = dataFields(value, ['type', 'id', 'revision'], ['expectedFingerprint'])
  const id = dataIdentity(input.id); const revision = dataRevision(input.revision)
  if (!revision) throw new Error('Invalid network revision')
  if (input.type === 'archivePreview') { dataFields(input, ['type', 'id', 'revision']); return { type: 'archivePreview', id, revision } }
  if (input.type !== 'archiveNetwork') throw new Error('Invalid network retirement command')
  dataFields(input, ['type', 'id', 'revision', 'expectedFingerprint'])
  return { type: 'archiveNetwork', id, revision, expectedFingerprint: hash(input.expectedFingerprint) }
}

export function parseArchivePreview(value: unknown): ArchivePreview {
  const input = dataFields(value, ['fingerprint', 'issues', 'members'])
  hash(input.fingerprint); dataRevision(input.members)
  if (!Array.isArray(input.issues) || input.issues.length > 64 || input.issues.some(issue => typeof issue !== 'string' || issue.length > 2000)) throw new Error('Invalid archive review')
  return input as unknown as ArchivePreview
}
