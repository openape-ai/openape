import type { InStatement } from '@libsql/client'

export interface ObjectValue { bytes: Uint8Array, etag: string }
export interface ObjectStore {
  get: (key: string) => Promise<ObjectValue | null>
  put: (key: string, bytes: Uint8Array, expected: string | null) => Promise<string>
}
export interface RecoveryRef { key: string, digest: string }
export interface RecoveryCheckpoint { snapshot: string, path: string, digest: string, fingerprint: string }
export interface RecoveryHead {
  schema: 1
  instance: string
  sequence: number
  tip: RecoveryRef | null
  checkpoint: RecoveryCheckpoint
  fingerprint: string
}
export type EncodedValue = null | string | number | boolean | { type: 'bigint' | 'bytes' | 'date', value: string }
export interface EncodedStatement { sql: string, args: EncodedValue[] | Record<string, EncodedValue> }
export interface RecoveryRecord {
  schema: 1
  instance: string
  sequence: number
  previous: RecoveryRef | null
  statements: EncodedStatement[]
  fingerprint: string
}
export interface LocalRecoveryState { instance: string, sequence: number, tip: RecoveryRef | null }
export interface RecoverySession {
  head: RecoveryHead
  etag: string
  store: ObjectStore
  key: Uint8Array
  failure?: Error
}
export interface RecoveryConfig {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  encryptionKey: string
}
export type ReplayStatement = InStatement
