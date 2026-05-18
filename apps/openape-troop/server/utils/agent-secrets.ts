import type { SealedBox } from '@openape/core'
import { seal } from '@openape/core'

// Capability-broker core. troop never stores a secret in plaintext: a
// bound secret is sealed to the agent's X25519 public key (M2a sealed-box)
// the moment it is submitted, and only the sealed blob is persisted. The
// agent opens it with its private key (M2b) — the agent is the only place
// plaintext exists. Frame builders here produce the payloads M2d pushes
// over the troop↔nest WS. See plans.openape.ai 01KRTAE8 (M2c).

const ENV_RE = /^[A-Z][A-Z0-9_]*$/

export function validateEnvName(env: string): { ok: true } | { ok: false, reason: string } {
  if (!ENV_RE.test(env)) {
    return { ok: false, reason: 'env name must be UPPER_SNAKE_CASE ([A-Z][A-Z0-9_]*)' }
  }
  return { ok: true }
}

/** Seal a secret value to the agent's X25519 public key (base64url DER). */
export function sealSecret(pubkeyX25519: string | null | undefined, value: string): SealedBox {
  if (!pubkeyX25519) {
    throw new Error('agent has no X25519 public key yet — it must sync once after spawn before secrets can be bound')
  }
  return seal(value, pubkeyX25519)
}

/** Persisted form of a sealed box (single JSON string column). */
export function serializeSealed(box: SealedBox): string {
  return JSON.stringify(box)
}

export function deserializeSealed(s: string): SealedBox {
  return JSON.parse(s) as SealedBox
}

export interface SecretUpdateFrame {
  type: 'secret-update'
  agent_email: string
  env: string
  /** Serialized SealedBox — nest relays this opaquely, never opens it. */
  blob: string
}

export interface SecretRevokeFrame {
  type: 'secret-revoke'
  agent_email: string
  env: string
}

export function buildSecretUpdateFrame(agentEmail: string, env: string, box: SealedBox): SecretUpdateFrame {
  return { type: 'secret-update', agent_email: agentEmail, env, blob: serializeSealed(box) }
}

export function buildSecretRevokeFrame(agentEmail: string, env: string): SecretRevokeFrame {
  return { type: 'secret-revoke', agent_email: agentEmail, env }
}
