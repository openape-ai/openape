export const protocol = { name: 'pods-mobile', major: 1, minor: 0 } as const
export const limits = { frameBytes: 65536, pending: 100, dispatchLeaseMs: 30000, clockSkewMs: 30000, replayMs: 86400000, receiptMs: 2592000000 } as const
export const commandKinds = ['pod.create', 'pod.rename', 'pod.pause', 'pod.resume', 'chat.send', 'chat.cancel', 'changes.apply', 'changes.discard', 'setup.respond', 'review.prepare', 'review.decide', 'run.start', 'run.cancel'] as const
export const queryKinds = ['inventory', 'conversation', 'run', 'reviews', 'operation', 'catalog'] as const
export type CommandKind = typeof commandKinds[number]
export type QueryKind = typeof queryKinds[number]
export interface Capabilities { major: number, minor: number, commands: string[], queries: string[], contentModes: string[] }
export const capabilities: Capabilities = { major: 1, minor: 0, commands: [...commandKinds], queries: [...queryKinds], contentModes: ['encrypted-v1'] }
export function negotiateCapabilities(value: unknown): Capabilities {
  const input = object(value, ['major', 'minor', 'commands', 'queries', 'contentModes'])
  if (input.major !== protocol.major) throw new ProtocolError('unsupported_version', 426)
  integer(input.minor, 0)
  function intersection(key: 'commands' | 'queries' | 'contentModes'): string[] {
    const offered = input[key]
    if (!Array.isArray(offered) || offered.length > 100 || offered.some(item => typeof item !== 'string' || item.length > 100)) throw new ProtocolError('invalid_capabilities')
    return capabilities[key].filter(item => offered.includes(item))
  }
  const contentModes = intersection('contentModes')
  if (!contentModes.includes('encrypted-v1')) throw new ProtocolError('encryption_required', 426)
  return { major: 1, minor: Math.min(Number(input.minor), protocol.minor), commands: intersection('commands'), queries: intersection('queries'), contentModes }
}
export type OperationState = 'accepted' | 'received' | 'applied' | 'started' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'expired' | 'unknown'
export interface Owner { issuer: string, subject: string }
export interface DeviceKeys { signing: string, agreement: string }
export interface Route {
  protocol: 'pods-mobile'
  major: 1
  minor: number
  id: string
  runtimeId: string
  generation: string
  deviceId: string
  keyEpoch: number
  owner: Owner
  direction: 'command' | 'query' | 'response' | 'event'
  kind: CommandKind | QueryKind | 'receipt' | 'snapshot'
  kindVersion: 1
  issuedAt: string
  expiresAt: string
  sequence: string
}
export interface SealedEnvelope {
  route: Route
  contentMode: 'encrypted-v1'
  ephemeralKey: string
  nonce: string
  ciphertext: string
  signature: string
}
export interface CommandBody {
  podId?: string
  conversationId?: string
  runId?: string
  catalogId?: string
  reviewId?: string
  name?: string
  text?: string
  decision?: 'approve' | 'deny'
  expected?: { podRevision?: number, contextRevision?: number, reviewRevision?: number, resourceEpoch?: number, scriptHash?: string, variableRevision?: number, proposalHash?: string }
}
export interface Receipt {
  operationId: string
  state: OperationState
  source: 'relay' | 'desktop'
  updatedAt: string
  podId?: string
  conversationId?: string
  runId?: string
  code?: string
}
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
export function integer(value: unknown, minimum = 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new ProtocolError('invalid_integer')
  return value as number
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
export function parseRoute(value: unknown): Route {
  const item = object(value, ['protocol', 'major', 'minor', 'id', 'runtimeId', 'generation', 'deviceId', 'keyEpoch', 'owner', 'direction', 'kind', 'kindVersion', 'issuedAt', 'expiresAt', 'sequence'])
  if (item.protocol !== protocol.name || item.major !== 1 || item.kindVersion !== 1) throw new ProtocolError('unsupported_version', 426)
  integer(item.minor, 0)
  for (const key of ['id', 'runtimeId', 'generation', 'deviceId']) uuid(item[key])
  integer(item.keyEpoch)
  const owner = parseOwner(item.owner)
  if (!['command', 'query', 'response', 'event'].includes(String(item.direction))) throw new ProtocolError('invalid_direction')
  const kinds: readonly string[] = item.direction === 'command' ? commandKinds : item.direction === 'query' ? queryKinds : ['receipt', 'snapshot']
  if (!kinds.includes(String(item.kind))) throw new ProtocolError('unsupported_operation', 426)
  timestamp(item.issuedAt); timestamp(item.expiresAt)
  const duration = Date.parse(item.expiresAt as string) - Date.parse(item.issuedAt as string)
  const maximum = ['response', 'event'].includes(String(item.direction)) ? limits.replayMs : item.direction === 'command' && !['pod.create', 'chat.send'].includes(String(item.kind)) ? 60000 : 300000
  if (duration <= 0 || duration > maximum) throw new ProtocolError('invalid_expiry')
  if (typeof item.sequence !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(item.sequence)) throw new ProtocolError('invalid_sequence')
  return { ...item, owner } as unknown as Route
}
export function assertFresh(route: Route, now = Date.now()): void {
  if (Date.parse(route.issuedAt) > now + limits.clockSkewMs) throw new ProtocolError('clock_skew', 409)
  if (Date.parse(route.expiresAt) <= now) throw new ProtocolError('operation_expired', 410)
}
export function parseEnvelope(value: unknown): SealedEnvelope {
  const item = object(value, ['route', 'contentMode', 'ephemeralKey', 'nonce', 'ciphertext', 'signature'])
  if (item.contentMode !== 'encrypted-v1') throw new ProtocolError('encryption_required', 426)
  if (new TextEncoder().encode(JSON.stringify(value)).length > limits.frameBytes) throw new ProtocolError('frame_too_large', 413)
  const route = parseRoute(item.route)
  base64url(item.ephemeralKey, 65); base64url(item.nonce, 12); base64url(item.signature, 64); base64url(item.ciphertext)
  return { ...item, route } as unknown as SealedEnvelope
}
export function parseCommand(kind: CommandKind, value: unknown): CommandBody {
  const common = ['podId', 'expected']
  const fields: Record<CommandKind, string[]> = {
    'pod.create': ['name'], 'pod.rename': [...common, 'name'], 'pod.pause': common, 'pod.resume': common,
    'chat.send': [...common, 'conversationId', 'text'], 'chat.cancel': [...common, 'conversationId'],
    'changes.apply': [...common, 'conversationId', 'reviewId'], 'changes.discard': [...common, 'conversationId', 'reviewId'],
    'setup.respond': [...common, 'conversationId', 'reviewId', 'text'], 'review.decide': [...common, 'reviewId', 'decision'], 'review.prepare': [...common, 'catalogId'],
    'run.start': common, 'run.cancel': [...common, 'runId'],
  }
  const item = object(value, fields[kind])
  if (kind === 'pod.create') return { name: text(item.name, 100) }
  uuid(item.podId)
  if (fields[kind].includes('conversationId')) uuid(item.conversationId)
  if (fields[kind].includes('reviewId')) uuid(item.reviewId)
  if (fields[kind].includes('catalogId')) uuid(item.catalogId)
  if (fields[kind].includes('runId')) uuid(item.runId)
  if (fields[kind].includes('name')) text(item.name, 100)
  if (fields[kind].includes('text')) text(item.text)
  if (kind === 'review.decide' && !['approve', 'deny'].includes(String(item.decision))) throw new ProtocolError('invalid_decision')
  const expected = object(item.expected, ['podRevision', 'contextRevision', 'reviewRevision', 'resourceEpoch', 'scriptHash', 'variableRevision', 'proposalHash'])
  for (const [key, revision] of Object.entries(expected)) {
    if (key === 'scriptHash' || key === 'proposalHash') {
      if (typeof revision !== 'string' || !/^[\da-f]{64}$/.test(revision)) throw new ProtocolError('invalid_hash')
    }
    else {
      integer(revision, ['resourceEpoch', 'variableRevision'].includes(key) ? 0 : 1)
    }
  }
  integer(expected.podRevision)
  if (fields[kind].includes('conversationId')) integer(expected.contextRevision)
  if (fields[kind].includes('reviewId') && kind !== 'setup.respond') integer(expected.reviewRevision)
  if (kind === 'setup.respond') { integer(expected.variableRevision, 0); if (!expected.proposalHash) throw new ProtocolError('setup_review_required') }
  if (kind === 'review.decide' || kind === 'review.prepare') integer(expected.resourceEpoch, 0)
  if (kind === 'run.start') {
    integer(expected.resourceEpoch, 0)
    if (!expected.scriptHash) throw new ProtocolError('script_review_required')
  }
  return item as CommandBody
}

// The protocol signs fixed, typed tuples rather than language-specific JSON objects.
export function routeBytes(route: Route): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([route.protocol, route.major, route.minor, route.id, route.runtimeId, route.generation, route.deviceId, route.keyEpoch, route.owner.issuer, route.owner.subject, route.direction, route.kind, route.kindVersion, route.issuedAt, route.expiresAt, route.sequence]))
}
