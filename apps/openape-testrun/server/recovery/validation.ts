import type { RecoveryHead, RecoveryRecord, RecoveryRef } from './types'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Recovery object must be a record')
  return value as Record<string, unknown>
}
function sequence(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid recovery sequence')
}
export function reference(value: unknown): RecoveryRef | null {
  if (value === null) return null
  const v = object(value)
  if (typeof v.key !== 'string' || !/^records\/\d+-[a-f0-9-]+$/.test(v.key) || typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest)) throw new Error('Invalid recovery reference')
  return { key: v.key, digest: v.digest }
}
export function parseHead(value: unknown): RecoveryHead {
  const v = object(value)
  sequence(v.sequence)
  if (v.schema !== 1 || typeof v.instance !== 'string' || !/^[a-f0-9]{32}$/.test(v.instance)) throw new Error('Invalid recovery head identity')
  if (typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint)) throw new Error('Invalid recovery state fingerprint')
  const checkpoint = object(v.checkpoint)
  if (typeof checkpoint.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.fingerprint)) throw new Error('Invalid checkpoint fingerprint')
  if (typeof checkpoint.snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.snapshot) || typeof checkpoint.path !== 'string' || !checkpoint.path.startsWith('/') || typeof checkpoint.digest !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.digest)) throw new Error('Invalid recovery checkpoint')
  const tip = reference(v.tip)
  if ((v.sequence === 0) !== (tip === null)) throw new Error('Recovery head sequence/reference mismatch')
  return { schema: 1, instance: v.instance, sequence: Number(v.sequence), tip, checkpoint: { snapshot: checkpoint.snapshot, path: checkpoint.path, digest: checkpoint.digest, fingerprint: checkpoint.fingerprint }, fingerprint: v.fingerprint }
}
export function parseRecord(value: unknown): RecoveryRecord {
  const v = object(value)
  sequence(v.sequence)
  if (v.schema !== 1 || typeof v.instance !== 'string' || !/^[a-f0-9]{32}$/.test(v.instance) || v.sequence === 0 || !Array.isArray(v.statements)) throw new Error('Invalid recovery transaction')
  if (typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint)) throw new Error('Invalid transaction fingerprint')
  for (const raw of v.statements) {
    const statement = object(raw)
    if (typeof statement.sql !== 'string' || !statement.args || typeof statement.args !== 'object') throw new Error('Invalid recovered SQL statement')
    for (const arg of Object.values(statement.args)) {
      if (arg === null || ['string', 'boolean'].includes(typeof arg) || (typeof arg === 'number' && Number.isFinite(arg))) continue
      const encoded = object(arg)
      if (!['bigint', 'bytes', 'date'].includes(String(encoded.type)) || typeof encoded.value !== 'string') throw new Error('Invalid recovered SQL argument')
    }
  }
  return { schema: 1, instance: v.instance, sequence: Number(v.sequence), previous: reference(v.previous), statements: v.statements as RecoveryRecord['statements'], fingerprint: v.fingerprint }
}
export function sameReference(a: RecoveryRef | null, b: RecoveryRef | null) { return a?.key === b?.key && a?.digest === b?.digest }
