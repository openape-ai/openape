export * from './releases'
export * from './sharing'

export interface Owner { issuer: string, subject: string }
export interface DeviceKeys { signing: string, agreement: string }
export class ProtocolError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ProtocolError('invalid_fields')
  return value as Record<string, unknown>
}
export function text(value: unknown, maximum = 20000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0')) throw new ProtocolError('invalid_text')
  return value
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(value)) throw new ProtocolError('invalid_id')
  return value
}
export function base64url(value: unknown, bytes?: number): string {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value) || value.length % 4 === 1 || (bytes !== undefined && value.length !== Math.ceil(bytes * 4 / 3))) throw new ProtocolError('invalid_encoding')
  const final = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(value.at(-1)!)
  if ((value.length % 4 === 2 && (final & 15) !== 0) || (value.length % 4 === 3 && (final & 3) !== 0)) throw new ProtocolError('invalid_encoding')
  return value
}
export function parseOwner(value: unknown): Owner {
  const item = object(value, ['issuer', 'subject'])
  const issuer = text(item.issuer, 2048)
  const url = new URL(issuer)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ProtocolError('invalid_issuer')
  return { issuer, subject: text(item.subject, 320) }
}
export function sameOwner(one: Owner, two: Owner): boolean { return one.issuer === two.issuer && one.subject === two.subject }
export function parseKeys(value: unknown): DeviceKeys {
  const item = object(value, ['signing', 'agreement'])
  return { signing: base64url(item.signing, 65), agreement: base64url(item.agreement, 65) }
}
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ProtocolError('invalid_timestamp')
  return value
}
