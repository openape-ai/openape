import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server'
import type { RecoveryRecord, Sealed, SealedSecret } from '#shared/vault-crypto'
import { b64u, createRecovery, createSigningKey, credentialKek, formatRecoveryCode, fromB64u, newRecoverySecret, newVmk, openRecovery, openSecret, openSigningKey, parseRecoveryCode, sealDelivery, sealSecret, signDelivery, unwrapVmk, wrapVmk } from '#shared/vault-crypto'
import { confirmWithPasskey, createVaultPasskey, PasskeyError, passkeyLabel } from './passkeys'

/**
 * The owner's side of the vault flows. Keys live in local variables for the
 * length of one flow and are zeroed afterwards; nothing here goes into
 * component state, storage or the network except ciphertext.
 */

type Bytes = Uint8Array<ArrayBuffer>

export interface VaultCredential {
  id: string
  label: string
  created_at: number
  transports: string[]
  prfInput: string
  kdfSalt: string
  vmkWrap: Sealed
}

export interface VaultView {
  id: string | null
  created_at?: number
  has_recovery: boolean
  signing_key_fingerprint?: string | null
  credentials: VaultCredential[]
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))

export function loadVault(): Promise<VaultView> {
  return $fetch<VaultView>('/api/v2/vault')
}

/** Wrap the VMK for a freshly proven passkey. */
async function wrapForPasskey(vmk: Bytes, vaultId: string, credentialId: string, prf: Bytes) {
  const kdfSalt = random(32)
  const vmkWrap = await wrapVmk(await credentialKek(prf, kdfSalt, vaultId, credentialId), vmk, vaultId, credentialId)
  prf.fill(0)
  return { kdfSalt: b64u(kdfSalt), vmkWrap }
}

async function vmkFromConfirmation(vault: VaultView, confirmation: { credentialId: string, prf: Bytes }): Promise<Bytes> {
  const credential = vault.credentials.find(c => c.id === confirmation.credentialId)
  if (!vault.id || !credential) throw new PasskeyError('This passkey does not belong to your vault.')
  const kek = await credentialKek(confirmation.prf, fromB64u(credential.kdfSalt), vault.id, credential.id)
  confirmation.prf.fill(0)
  return unwrapVmk(kek, credential.vmkWrap, vault.id, credential.id).catch(() => {
    throw new PasskeyError('This passkey could not open your vault.')
  })
}

const prfInputs = (vault: VaultView) => Object.fromEntries(vault.credentials.map(c => [c.id, c.prfInput]))

/**
 * Setup, step 1: create the first passkey and every wrapper locally. Nothing is
 * stored yet; `commit` creates the vault once the owner saved the recovery kit.
 */
export async function prepareVault() {
  const options = await $fetch<{ challengeId: string, vaultId: string, publicKey: PublicKeyCredentialCreationOptionsJSON }>('/api/v2/vault/setup/options', { method: 'POST' })
  const prfInput = random(32)
  const passkey = await createVaultPasskey(options.publicKey, prfInput)
  const vmk = newVmk()
  const recoverySecret = newRecoverySecret()
  const wrapped = await wrapForPasskey(vmk, options.vaultId, passkey.response.id, passkey.prf)
  const recovery: RecoveryRecord = await createRecovery(vmk, recoverySecret, options.vaultId)
  const signingKey = await createSigningKey(vmk, options.vaultId)
  const code = formatRecoveryCode(recoverySecret)
  vmk.fill(0)
  recoverySecret.fill(0)

  return {
    code,
    label: passkeyLabel(passkey.response.authenticatorAttachment),
    commit: () => $fetch('/api/v2/vault/setup/commit', {
      method: 'POST',
      body: { challengeId: options.challengeId, credential: passkey.response, label: passkeyLabel(passkey.response.authenticatorAttachment), prfInput: b64u(prfInput), recovery, signingKey, ...wrapped },
    }),
  }
}

/** Open the vault locally with any of its passkeys, prove it worked, and lock it again. */
export async function testUnlock(vault: VaultView): Promise<string> {
  const confirmation = await confirmWithPasskey({
    challenge: b64u(random(32)),
    allowCredentials: vault.credentials.map(c => ({ id: c.id, type: 'public-key' })),
    userVerification: 'required',
  }, prfInputs(vault))
  const vmk = await vmkFromConfirmation(vault, confirmation)
  vmk.fill(0)
  return vault.credentials.find(c => c.id === confirmation.credentialId)?.label ?? 'Passkey'
}

/** Confirm with an existing passkey, then wrap the same VMK for a new one. */
export async function addPasskey(vault: VaultView) {
  const options = await $fetch<{ challengeId: string, vaultId: string, assertion: PublicKeyCredentialRequestOptionsJSON, publicKey: PublicKeyCredentialCreationOptionsJSON }>('/api/v2/vault/credentials/options', { method: 'POST' })
  const confirmation = await confirmWithPasskey(options.assertion, prfInputs(vault))
  const vmk = await vmkFromConfirmation(vault, confirmation)
  const prfInput = random(32)
  let wrapped: Awaited<ReturnType<typeof wrapForPasskey>>
  let passkey: Awaited<ReturnType<typeof createVaultPasskey>>
  try {
    passkey = await createVaultPasskey(options.publicKey, prfInput)
    wrapped = await wrapForPasskey(vmk, options.vaultId, passkey.response.id, passkey.prf)
  }
  finally {
    vmk.fill(0)
  }
  await $fetch('/api/v2/vault/credentials/commit', {
    method: 'POST',
    body: { challengeId: options.challengeId, assertion: confirmation.response, credential: passkey.response, label: passkeyLabel(passkey.response.authenticatorAttachment), prfInput: b64u(prfInput), ...wrapped },
  })
}

/** Replace lost passkeys: open the recovery wrapper locally, prove it, register a new passkey. */
export async function recoverVault(code: string) {
  const secret = parseRecoveryCode(code)
  const options = await $fetch<{ challengeId: string, challenge: string, vaultId: string, recovery: RecoveryRecord, publicKey: PublicKeyCredentialCreationOptionsJSON }>('/api/v2/vault/recovery/options', { method: 'POST' })
  const opened = await openRecovery(secret, options.recovery, options.vaultId).catch(() => {
    throw new PasskeyError('This recovery code does not open your vault. Check it for typos.')
  }).finally(() => secret.fill(0))
  const proof = await opened.sign(options.challenge)
  const prfInput = random(32)
  let wrapped: Awaited<ReturnType<typeof wrapForPasskey>>
  let passkey: Awaited<ReturnType<typeof createVaultPasskey>>
  try {
    passkey = await createVaultPasskey(options.publicKey, prfInput)
    wrapped = await wrapForPasskey(opened.vmk, options.vaultId, passkey.response.id, passkey.prf)
  }
  finally {
    opened.vmk.fill(0)
  }
  await $fetch('/api/v2/vault/recovery/commit', {
    method: 'POST',
    body: { challengeId: options.challengeId, challenge: options.challenge, proof, credential: passkey.response, label: passkeyLabel(passkey.response.authenticatorAttachment), prfInput: b64u(prfInput), ...wrapped },
  })
}

export type SecretType = 'token' | 'password' | 'key' | 'note'

export const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  token: 'API token',
  password: 'Password',
  key: 'Key',
  note: 'Note',
}

export interface SecretSummary {
  id: string
  alias: string
  type: SecretType
  version: number
  created_at: number
  updated_at: number
}

export interface SecretDetail extends SecretSummary {
  versions: Array<{ version: number, created_at: number }>
  sealed: SealedSecret
}

interface ActionOptions {
  challengeId: string
  vaultId: string
  secretId: string
  version: number
  assertion: PublicKeyCredentialRequestOptionsJSON
}

export function listSecrets(): Promise<SecretSummary[]> {
  return $fetch<SecretSummary[]>('/api/v2/secrets')
}

export function readSecret(id: string): Promise<SecretDetail> {
  return $fetch<SecretDetail>(`/api/v2/secrets/${id}`)
}

/** Open the current value locally. The passkey ceremony never reaches the server. */
export async function revealSecret(vault: VaultView, secret: SecretDetail): Promise<string> {
  const confirmation = await confirmWithPasskey({
    challenge: b64u(random(32)),
    allowCredentials: vault.credentials.map(c => ({ id: c.id, type: 'public-key' })),
    userVerification: 'required',
  }, prfInputs(vault))
  const vmk = await vmkFromConfirmation(vault, confirmation)
  try {
    return await openSecret(vmk, secret.sealed, { vaultId: vault.id!, secretId: secret.id, version: secret.version })
  }
  finally {
    vmk.fill(0)
  }
}

/** Confirm a prepared change with a passkey; `seal` gets the unlocked VMK for saves. */
async function runAction(vault: VaultView, request: Record<string, unknown>, seal?: (vmk: Bytes, o: ActionOptions) => Promise<Record<string, unknown>>) {
  const options = await $fetch<ActionOptions>('/api/v2/vault/actions/options', { method: 'POST', body: request })
  const confirmation = await confirmWithPasskey(options.assertion, prfInputs(vault))
  const vmk = await vmkFromConfirmation(vault, confirmation)
  let fields: Record<string, unknown> = {}
  try {
    if (seal) fields = await seal(vmk, options)
  }
  finally {
    vmk.fill(0)
  }
  return $fetch<{ secret_id: string, version: number }>('/api/v2/vault/actions/commit', {
    method: 'POST',
    body: { challengeId: options.challengeId, assertion: confirmation.response, ...fields },
  })
}

/** Save a new secret, or the next version of an existing one. */
export function saveSecret(vault: VaultView, input: { secretId?: string, alias?: string, type?: SecretType, value: string }) {
  return runAction(vault, { action: 'secret.save', secretId: input.secretId }, async (vmk, o) => ({
    alias: input.alias,
    type: input.type,
    sealed: await sealSecret(vmk, input.value, { vaultId: o.vaultId, secretId: o.secretId, version: o.version }),
  }))
}

/** Remove a lost passkey, confirmed with one of the passkeys that stay. */
export function removePasskey(vault: VaultView, credentialId: string) {
  return runAction(vault, { action: 'credential.disable', credentialId })
}

export function deleteSecret(vault: VaultView, secretId: string) {
  return runAction(vault, { action: 'secret.delete', secretId })
}

export type ApprovalMode = 'once' | 'timed' | 'standing'

export interface OwnerRequest {
  id: string
  status: string
  field_name: string
  purpose: string
  requester: string
  requester_act: string
  created_at: number
  expires_at: number
  consumer: { id: string, name: string, fingerprint: string, key_changed: boolean }
  secret: { id: string, alias: string, type: SecretType, version: number } | null
  approval?: { id: string, status: string, mode: ApprovalMode, expires_at: number | null, created_at: number, decided_at: number | null, collect_count: number, last_collected_at: number | null } | null
}

export interface ApprovalView {
  id: string
  status: string
  mode: ApprovalMode
  expires_at: number | null
  created_at: number
  consumed_at: number | null
  revoked_at: number | null
  collect_count: number
  last_collected_at: number | null
  requester: string
  consumer: { id: string, name: string, fingerprint: string }
  secret: { id: string, alias: string, version: number }
}

interface ApprovalOptions {
  challengeId: string
  approvalId: string
  descriptor: { secretId: string, version: number, consumerKeyFingerprint: string }
  consumer: { publicKeyJwk: JsonWebKey }
  sealed: SealedSecret | null
  signing: { keyWrap: Sealed } | null
  assertion: PublicKeyCredentialRequestOptionsJSON
}

export const listRequests = () => $fetch<OwnerRequest[]>('/api/v2/requests')
export const readRequest = (id: string) => $fetch<OwnerRequest>(`/api/v2/requests/${id}`)
export const denyRequest = (id: string) => $fetch(`/api/v2/requests/${id}/deny`, { method: 'POST' })
export const listApprovals = () => $fetch<ApprovalView[]>('/api/v2/approvals')
export const revokeApproval = (id: string) => $fetch(`/api/v2/approvals/${id}/revoke`, { method: 'POST' })

/**
 * Approve one handover: the server fixes what is approved, a passkey unlocks
 * the vault here, the value is opened and sealed for the machine's key, and
 * only that package goes back. The value itself never leaves this browser.
 */
export async function approveRequest(vault: VaultView, requestId: string, mode: { mode: ApprovalMode, durationSec?: number }) {
  const options = await $fetch<ApprovalOptions>(`/api/v2/requests/${requestId}/approval/options`, { method: 'POST', body: mode })
  if (!options.sealed) throw new PasskeyError('This secret has no stored value to hand over.')
  const confirmation = await confirmWithPasskey(options.assertion, prfInputs(vault))
  const vmk = await vmkFromConfirmation(vault, confirmation)
  const d = options.descriptor
  const context = { vaultId: vault.id!, approvalId: options.approvalId, consumerKeyFingerprint: d.consumerKeyFingerprint, secretId: d.secretId, version: d.version }
  let pkg: Awaited<ReturnType<typeof sealDelivery>>
  let signature: string
  // A vault from before signing keys gets one now, under the VMK this approval unlocked.
  let signingKey: Awaited<ReturnType<typeof createSigningKey>> | undefined
  try {
    const value = await openSecret(vmk, options.sealed, { vaultId: vault.id!, secretId: d.secretId, version: d.version })
    pkg = await sealDelivery(options.consumer.publicKeyJwk, value, context)
    signingKey = options.signing ? undefined : await createSigningKey(vmk, vault.id!)
    signature = await signDelivery(await openSigningKey(vmk, options.signing ?? signingKey!, vault.id!), pkg, context)
  }
  finally {
    vmk.fill(0)
  }
  return $fetch<{ id: string, status: string, mode: ApprovalMode, expires_at: number | null, created_at: number }>(`/api/v2/requests/${requestId}/approval/commit`, {
    method: 'POST',
    body: { challengeId: options.challengeId, assertion: confirmation.response, package: pkg, signature, signingKey },
  })
}

/** "21:40 today" or "Fri 23 Oct, 21:25" — exact, in the owner's time zone. */
export function endsAt(sec: number): string {
  const date = new Date(sec * 1000)
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return `${time} today`
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}

/** "mail-triage@agents.example" → "Mail triage", for headings; the full identity is shown too. */
export function requesterName(identity: string): string {
  const local = identity.split('@')[0]?.replace(/[-_.]+/g, ' ').trim() || identity
  return local.charAt(0).toUpperCase() + local.slice(1)
}

/** The first 16 fingerprint characters in groups of four, as on every screen. */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 16).match(/.{1,4}/g)?.join(' ') ?? fingerprint
}

/** A message for the owner from any error a flow can raise. */
export function flowError(err: unknown): string {
  if (err instanceof PasskeyError) return err.message
  const e = err as { data?: { title?: string, detail?: string }, message?: string }
  return [e.data?.title, e.data?.detail].filter(Boolean).join('. ') || e.message || 'Something went wrong.'
}
