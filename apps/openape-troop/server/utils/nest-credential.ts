import type { CliTokenPayload } from './cli-token'
import { createHash, randomBytes } from 'node:crypto'

// Device-credential primitives for the nest-as-device model (M4δ-3).
//
// A keypair-less pod has no DDISA agent identity, so it can't drive the
// IdP token-exchange (which requires an actor_token with act='agent').
// Instead troop — the canonical issuer of host_ids — hands the pod a
// high-entropy *device secret* at bind time and stores only its SHA-256.
// On every reconnect the pod presents the plaintext to
// POST /api/nests/token and gets a short-lived, nest:*-scoped troop token.
//
// Why plain SHA-256 and not a slow KDF (bcrypt/scrypt): those defend
// low-entropy human passwords against offline brute force. A 256-bit
// random secret has no brute-force surface, so a single fast hash is the
// correct, standard choice for opaque API credentials.

// Operational scopes a bound device may exercise. Deliberately excludes
// `nest:bind` — binding is a one-time Owner action; a device must not be
// able to re-bind (mint new host_ids) using its own credential.
export const NEST_DEVICE_SCOPES = ['nest:spawn-agent', 'nest:report-status'] as const

// TTL for a minted device token. Short by design: the pod re-mints on
// reconnect, and a revoke takes effect within this window for any token
// already in flight.
export const NEST_TOKEN_TTL_SECONDS = 15 * 60

export function generateDeviceSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export interface NestDeviceIdentity {
  ownerEmail: string
  hostId: string
}

// `delegate` provenance prefix for a minted device token: `nest:<host_id>`.
const DELEGATE_PREFIX = 'nest:'

// Narrow a *verified* troop CLI token to a nest device identity. Returns
// null when the token isn't a device token (a first-party human token, or
// an IdP-signed token that verifyCliToken couldn't verify) so the caller
// can fall back to the IdP auth path. The host_id rides in `delegate`
// (`nest:<host_id>`) and is token-authoritative — troop never has to trust
// a nest's self-reported host_id in the hello frame. Note this does NOT
// check the nest is still active; the caller must verify the (owner,
// host_id) row against the nests table so a revoke takes effect.
export function parseNestDeviceToken(claims: CliTokenPayload | null): NestDeviceIdentity | null {
  if (!claims) return null
  if (claims.act !== 'agent') return null
  if (!claims.delegate?.startsWith(DELEGATE_PREFIX)) return null
  const hostId = claims.delegate.slice(DELEGATE_PREFIX.length)
  if (!hostId) return null
  if (!claims.scope?.includes('nest:report-status')) return null
  return { ownerEmail: claims.sub.toLowerCase(), hostId }
}
