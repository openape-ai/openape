import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import type { Sealed } from '#shared/vault-crypto'
import { withBusyRetry } from '@openape/sp-tasks'
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { ulid } from 'ulid'
import { b64u, fromB64u } from '#shared/vault-crypto'
import { useDb } from '../database/drizzle'
import { secretAuditEvents, vaultCredentials, webauthnChallenges } from '../database/schema'
import { createProblemError } from './problem'

export type Db = ReturnType<typeof useDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type CredentialRow = typeof vaultCredentials.$inferSelect

// Setup leaves time to write down the recovery code before the vault is created.
const CHALLENGE_TTL_SEC: Record<string, number> = { 'vault.setup': 30 * 60 }
const DEFAULT_CHALLENGE_TTL_SEC = 5 * 60
const encoder = new TextEncoder()

export const nowSec = () => Math.floor(Date.now() / 1000)

/**
 * A vault write transaction, retried on SQLite lock contention. libsql gives
 * each transaction its own connection and sets no busy timeout, so a second
 * writer would otherwise fail at once instead of waiting its turn.
 */
export function vaultTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withBusyRetry(() => useDb().transaction(fn))
}

function rp() {
  const config = useRuntimeConfig()
  return { rpID: String(config.vaultRpId), origin: String(config.vaultOrigin) }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

/** A fresh single-use challenge for one owner and one operation; only its hash is stored. */
export async function issueChallenge(owner: string, operation: string, vaultId: string, descriptor?: Record<string, unknown>): Promise<{ challengeId: string, challenge: string }> {
  const challenge = b64u(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32))))
  const challengeId = ulid()
  await useDb().insert(webauthnChallenges).values({
    id: challengeId,
    challengeHash: await sha256Hex(challenge),
    ownerEmail: owner,
    operation,
    vaultId,
    descriptor: descriptor ? JSON.stringify(descriptor) : null,
    expiresAt: nowSec() + (CHALLENGE_TTL_SEC[operation] ?? DEFAULT_CHALLENGE_TTL_SEC),
    createdAt: nowSec(),
  })
  return { challengeId, challenge }
}

/**
 * Burn a challenge inside the caller's transaction. Missing, expired, used,
 * foreign-owner and wrong-operation challenges all look the same: refused.
 * If the transaction later fails, the burn rolls back with it.
 */
export async function consumeChallenge(tx: Tx, challengeId: unknown, owner: string, operation: string) {
  const row = typeof challengeId === 'string'
    ? await tx.update(webauthnChallenges)
        .set({ consumedAt: nowSec() })
        .where(and(
          eq(webauthnChallenges.id, challengeId),
          eq(webauthnChallenges.ownerEmail, owner),
          eq(webauthnChallenges.operation, operation),
          isNull(webauthnChallenges.consumedAt),
          gt(webauthnChallenges.expiresAt, nowSec()),
        ))
        .returning()
        .get()
    : undefined
  if (!row) throw createProblemError({ status: 400, title: 'This confirmation expired or was already used', detail: 'Start again.' })
  return {
    vaultId: row.vaultId,
    descriptor: row.descriptor ? JSON.parse(row.descriptor) as Record<string, unknown> : {},
    matches: async (challenge: string) => (await sha256Hex(challenge)) === row.challengeHash,
  }
}

export function registrationOptions(owner: string, vaultId: string, challenge: string, existing: CredentialRow[]): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: 'OpenApe Secrets',
    rpID: rp().rpID,
    userName: owner,
    userID: encoder.encode(vaultId),
    challenge: fromB64u(challenge),
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.id, transports: JSON.parse(c.transports) as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  })
}

export function authenticationOptions(challenge: string, credentials: CredentialRow[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp().rpID,
    challenge: fromB64u(challenge),
    userVerification: 'required',
    allowCredentials: credentials.map(c => ({ id: c.id, transports: JSON.parse(c.transports) as AuthenticatorTransportFuture[] })),
  })
}

/** PRF output stays in the browser. A response that carries it is refused, never stored. */
function refusePrfOutput(response: { clientExtensionResults?: unknown }) {
  const ext = response.clientExtensionResults as { prf?: { results?: unknown } } | undefined
  if (ext?.prf?.results) {
    throw createProblemError({ status: 400, title: 'Passkey response contains PRF output', detail: 'Remove clientExtensionResults.prf.results before sending.' })
  }
}

const refused = (title: string) => createProblemError({ status: 400, title })

/** Verify a new passkey's registration: right origin, RP, challenge and user verification. */
export async function verifyNewPasskey(response: unknown, matches: (challenge: string) => Promise<boolean>) {
  if (!response || typeof response !== 'object') throw refused('Passkey response missing')
  refusePrfOutput(response as RegistrationResponseJSON)
  const { rpID, origin } = rp()
  const result = await verifyRegistrationResponse({
    response: response as RegistrationResponseJSON,
    expectedChallenge: matches,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  }).catch(() => null)
  if (!result?.verified) throw refused('Passkey could not be verified')
  const { credential, credentialBackedUp, credentialDeviceType } = result.registrationInfo
  return {
    id: credential.id,
    publicKey: b64u(credential.publicKey),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    backedUp: credentialBackedUp ? 1 : 0,
    deviceType: credentialDeviceType,
  }
}

/** Verify a fresh assertion from one of the vault's active passkeys and advance its counter. */
export async function verifyVaultPasskey(tx: Tx, vaultId: string, response: unknown, matches: (challenge: string) => Promise<boolean>): Promise<CredentialRow> {
  if (!response || typeof response !== 'object') throw refused('Passkey confirmation missing')
  const assertion = response as AuthenticationResponseJSON
  refusePrfOutput(assertion)
  const row = typeof assertion.id === 'string'
    ? await tx.select().from(vaultCredentials).where(and(
        eq(vaultCredentials.id, assertion.id),
        eq(vaultCredentials.vaultId, vaultId),
        isNull(vaultCredentials.disabledAt),
      )).get()
    : undefined
  if (!row) throw refused('This passkey does not belong to your vault')
  const { rpID, origin } = rp()
  const result = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: matches,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: row.id, publicKey: fromB64u(row.publicKey), counter: row.counter, transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[] },
  }).catch(() => null)
  if (!result?.verified) throw refused('Passkey confirmation could not be verified')
  await tx.update(vaultCredentials).set({ counter: result.authenticationInfo.newCounter }).where(eq(vaultCredentials.id, row.id))
  return row
}

const B64U = /^[\w-]+$/

/** An unpadded base64url string that decodes to exactly `bytes` bytes (or within `max`). */
export function b64uField(value: unknown, name: string, bytes: { exact?: number, max?: number }): string {
  const decoded = typeof value === 'string' && B64U.test(value) ? fromB64u(value).length : -1
  const ok = bytes.exact !== undefined ? decoded === bytes.exact : decoded > 0 && decoded <= (bytes.max ?? 0)
  if (!ok) throw refused(`${name} is malformed`)
  return value as string
}

export function sealedField(value: unknown, name: string, maxCtBytes: number): Sealed {
  const v = value as Partial<Sealed> | undefined
  return { iv: b64uField(v?.iv, `${name}.iv`, { exact: 12 }), ct: b64uField(v?.ct, `${name}.ct`, { max: maxCtBytes }) }
}

/** The fields every new passkey brings: its PRF input, KDF salt and wrapped VMK (32 bytes + 16-byte tag). */
export function wrappedCredentialFields(body: Record<string, unknown>) {
  return {
    label: typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '',
    prfInput: b64uField(body.prfInput, 'prfInput', { exact: 32 }),
    kdfSalt: b64uField(body.kdfSalt, 'kdfSalt', { exact: 32 }),
    vmkWrap: sealedField(body.vmkWrap, 'vmkWrap', 48),
  }
}

export async function insertCredential(tx: Tx, vaultId: string, passkey: Awaited<ReturnType<typeof verifyNewPasskey>>, fields: ReturnType<typeof wrappedCredentialFields>) {
  await tx.insert(vaultCredentials).values({
    ...passkey,
    vaultId,
    label: fields.label,
    prfInput: fields.prfInput,
    kdfSalt: fields.kdfSalt,
    vmkIv: fields.vmkWrap.iv,
    vmkCt: fields.vmkWrap.ct,
    createdAt: nowSec(),
  })
}

export async function audit(tx: Tx, entry: { actor: string, event: string, vaultId: string, credentialId?: string }) {
  await tx.insert(secretAuditEvents).values({ id: ulid(), result: 'ok', createdAt: nowSec(), credentialId: null, ...entry })
}

export async function activeCredentials(db: Db | Tx, vaultId: string): Promise<CredentialRow[]> {
  return db.select().from(vaultCredentials).where(and(eq(vaultCredentials.vaultId, vaultId), isNull(vaultCredentials.disabledAt))).all()
}
