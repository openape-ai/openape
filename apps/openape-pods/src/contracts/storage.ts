/**
 * Storage readiness of a profile (issue 1465). The window, diagnostics and recovery never depend on the database;
 * automation starts only when the database is ready.
 */
export type StorageReason = 'busy' | 'disk-full' | 'permission' | 'io' | 'schema-newer' | 'schema-older' | 'conversion-blocked' | 'invalid-data' | 'corrupt' | 'missing' | 'timeout' | 'unknown'
export const storageReasons: StorageReason[] = ['busy', 'disk-full', 'permission', 'io', 'schema-newer', 'schema-older', 'conversion-blocked', 'invalid-data', 'corrupt', 'missing', 'timeout', 'unknown']
export interface StorageFailure { reason: StorageReason, message: string, at: number }
/** File facts of the database set, read without opening SQLite; nothing in it is written. */
export interface StorageFile { name: string, size: number, modifiedAt: number }
export interface StorageDiagnostics { profile: string, files: StorageFile[], header: { sqlite: boolean, pageSize: number | null, schema: number | null } | null, freeBytes: number | null }
export interface StorageBackup { path: string, createdAt: string, schema: number, bytes: number, files: number, valid: boolean, problem: string | null, automatic: boolean }
export interface StorageRecoveryView { failure: StorageFailure | null, diagnostics: StorageDiagnostics, backups: StorageBackup[], recoveryCopies: string[], lastAutomaticBackup: { at: number | null, error: string | null } }
export type StorageRecoveryCommand = { type: 'view' } | { type: 'retry' } | { type: 'preserve' } | { type: 'restore', path: string | null } | { type: 'openFolder' }

/** How long the window waits for the worker to report storage readiness before showing recovery (measured open: < 1 s). */
export const storageReadinessMs = 30_000

export function parseStorageFailure(value: unknown): StorageFailure {
  const input = value as Partial<StorageFailure> | null
  if (!input || typeof input !== 'object' || !storageReasons.includes(input.reason as StorageReason) || typeof input.message !== 'string' || !Number.isFinite(input.at)) throw new Error('Invalid storage failure')
  return { reason: input.reason as StorageReason, message: input.message.slice(0, 2000), at: Number(input.at) }
}

export function parseStorageRecoveryCommand(value: unknown): StorageRecoveryCommand {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid storage recovery command')
  if (['view', 'retry', 'preserve', 'openFolder'].includes(input.type as string) && Object.keys(input).length === 1) return { type: input.type } as StorageRecoveryCommand
  if (input.type === 'restore' && Object.keys(input).every(key => ['type', 'path'].includes(key)) && (input.path === null || (typeof input.path === 'string' && input.path.startsWith('/') && input.path.length <= 4096))) return { type: 'restore', path: input.path as string | null }
  throw new Error('Invalid storage recovery command')
}
