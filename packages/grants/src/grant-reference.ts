import type { BrokeredGrant, OpenApeGrant, OpenApeGrantRequest } from '@openape/core'

/** A reference is an opaque client value, never an authorization or a batch identity. */
export class InvalidGrantReferenceError extends Error {}
export class GrantReferenceConflictError extends Error {
  constructor() { super('The reference is already bound to a different authorization request') }
}

export function parseGrantReference(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 512 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
    throw new InvalidGrantReferenceError('reference must be 1–512 UTF-8 bytes without control or format characters')
  return value
}

export function assertGrantReferenceRequest(request: OpenApeGrantRequest): void {
  if (parseGrantReference(request.reference) === undefined) return
  if (request.grant_type !== 'once' || !Array.isArray(request.command) || !request.command.length || request.command.some(arg => typeof arg !== 'string' || arg.includes('\0')) || request.run_as || request.delegator || request.delegate || request.scopes || request.duration !== undefined)
    throw new InvalidGrantReferenceError('reference requires an exact single-use command without delegation or duration')
}

/** Full authority boundary, independent of broker-supplied display names. */
export function grantReferenceKey(requester: string, reference: string, brokered?: BrokeredGrant): string {
  return JSON.stringify([requester, reference, brokered
    ? [brokered.connection_id, brokered.broker_issuer, brokered.agent_issuer, brokered.owner, brokered.key_id]
    : null])
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
  return value
}

/** Presentation and submitter provenance do not change the requested authority. */
export function grantReferenceBinding(request: OpenApeGrantRequest): string {
  const { reference: _reference, batch: _batch, summary: _summary, reason: _reason, submitted_by: _submittedBy, ...authority } = request
  return JSON.stringify(canonical(authority))
}

export function assertSameReferencedGrant(existing: OpenApeGrant, incoming: OpenApeGrant): void {
  if (existing.request.reference !== incoming.request.reference
    || grantReferenceKey(existing.request.requester, existing.request.reference!, existing.brokered) !== grantReferenceKey(incoming.request.requester, incoming.request.reference!, incoming.brokered)
    || grantReferenceBinding(existing.request) !== grantReferenceBinding(incoming.request)) {
    throw new GrantReferenceConflictError()
  }
}
