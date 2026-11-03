import type { InStatement, InValue } from '@libsql/client'
import type { EncodedStatement, EncodedValue } from './types'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const MAGIC = Buffer.from('OAR1')
const NONCE_BYTES = 12
const TAG_BYTES = 16
const MAX_OBJECT_BYTES = 64 * 1024 * 1024
export class RecoveryRecordSizeError extends Error {
  statusCode = 413
  statusMessage = 'Report transaction exceeds the recoverable size limit'
  constructor() { super('Recovery record exceeds the 64 MiB boundary') }
}
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function seal(value: unknown, key: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw new Error('Recovery encryption requires a 32-byte key')
  const plaintext = JSON.stringify(value)
  if (Buffer.byteLength(plaintext) + MAGIC.length + NONCE_BYTES + TAG_BYTES > MAX_OBJECT_BYTES) throw new RecoveryRecordSizeError()
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(MAGIC)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const result = Buffer.concat([MAGIC, nonce, ciphertext, cipher.getAuthTag()])
  return result
}
export function unseal(bytes: Uint8Array, key: Uint8Array): unknown {
  const buffer = Buffer.from(bytes)
  if (buffer.length < MAGIC.length + NONCE_BYTES + TAG_BYTES || buffer.length > MAX_OBJECT_BYTES || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid recovery envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES))
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(buffer.subarray(-TAG_BYTES))
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(MAGIC.length + NONCE_BYTES, -TAG_BYTES)), decipher.final()]).toString('utf8'))
}
function encodeValue(value: InValue): EncodedValue {
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() }
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return { type: 'bytes', value: Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64') }
  if (value instanceof Date) return { type: 'date', value: value.toISOString() }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite SQL argument cannot be recovered')
  return value
}
function decodeValue(value: EncodedValue): InValue {
  if (typeof value !== 'object' || value === null) return value
  if (value.type === 'bigint') {
    if (!/^-?(?:0|[1-9]\d*)$/.test(value.value)) throw new Error('Invalid recovered bigint argument')
    return BigInt(value.value)
  }
  if (value.type === 'date') {
    const date = new Date(value.value)
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.value) throw new Error('Invalid recovered date argument')
    return date
  }
  const bytes = Buffer.from(value.value, 'base64')
  if (bytes.toString('base64') !== value.value) throw new Error('Invalid recovered binary argument')
  return bytes
}
export function encodeStatement(statement: InStatement): EncodedStatement {
  if (typeof statement === 'string') return { sql: statement, args: [] }
  return { sql: statement.sql, args: Array.isArray(statement.args) ? statement.args.map(encodeValue) : Object.fromEntries(Object.entries(statement.args ?? {}).map(([name, value]) => [name, encodeValue(value)])) }
}
export function decodeStatement(statement: EncodedStatement): InStatement {
  return { sql: statement.sql, args: Array.isArray(statement.args) ? statement.args.map(decodeValue) : Object.fromEntries(Object.entries(statement.args ?? {}).map(([name, value]) => [name, decodeValue(value)])) }
}
export function isReadStatement(statement: InStatement) { return /^\s*SELECT\b/i.test(typeof statement === 'string' ? statement : statement.sql) }
