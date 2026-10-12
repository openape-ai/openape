/** `restoreReview`: a restored profile waits for the owner to confirm external actions since the backup (issue 1465). */
export interface DataView { usedBytes: number, freeBytes: number, limitBytes: number, pendingDeletion: number, busy: boolean, error: string | null, result?: { path: string, kind: 'backup' | 'restore' | 'update' }, restoreReview?: { backupCreatedAt: string, restoredAt: string } | null }
export type DataCommand = { [K in 'status' | 'backup' | 'restore' | 'cleanup' | 'update']: { type: K } }['status' | 'backup' | 'restore' | 'cleanup' | 'update'] | { type: 'limit', bytes: number } | { type: 'deletePod', podId: string, revision: number, name: string } | { type: 'reviewRestore', evidence: string }
export function parseDataCommand(value: unknown): DataCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data operation')
  const command = value as Record<string, unknown>
  const fields = command.type === 'reviewRestore' ? ['type', 'evidence'] : command.type === 'limit' ? ['type', 'bytes'] : command.type === 'deletePod' ? ['type', 'podId', 'revision', 'name'] : ['status', 'backup', 'restore', 'cleanup', 'update'].includes(String(command.type)) ? ['type'] : []
  if (!fields.length || Object.keys(command).some(key => !fields.includes(key))) throw new Error('Unsupported data operation')
  if (command.type === 'limit' && (!Number.isSafeInteger(command.bytes) || (command.bytes as number) < 1024 ** 3 || (command.bytes as number) > 1024 ** 4)) throw new Error('Storage limit must be between 1 GiB and 1 TiB')
  if (command.type === 'deletePod' && (typeof command.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.podId) || !Number.isSafeInteger(command.revision) || (command.revision as number) < 1 || typeof command.name !== 'string' || !command.name || command.name.length > 100)) throw new Error('Invalid pod deletion review')
  if (command.type === 'reviewRestore' && (typeof command.evidence !== 'string' || !command.evidence.trim() || command.evidence.length > 4000)) throw new Error('Describe how you checked the external actions since the backup')
  return structuredClone(command) as DataCommand
}
export function parseDataView(value: unknown): DataView {
  if (!value || typeof value !== 'object') throw new Error('Invalid data response')
  const view = value as DataView
  if (![view.usedBytes, view.freeBytes, view.limitBytes, view.pendingDeletion].every(value => Number.isSafeInteger(value) && value >= 0) || typeof view.busy !== 'boolean' || (view.error !== null && typeof view.error !== 'string') || (view.result && (typeof view.result.path !== 'string' || !['backup', 'restore', 'update'].includes(view.result.kind)))) throw new Error('Invalid data state')
  return view
}
