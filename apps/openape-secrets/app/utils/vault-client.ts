import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server'
import type { RecoveryRecord, Sealed } from '#shared/vault-crypto'
import { b64u, createRecovery, credentialKek, formatRecoveryCode, fromB64u, newRecoverySecret, newVmk, openRecovery, parseRecoveryCode, unwrapVmk, wrapVmk } from '#shared/vault-crypto'
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
  const code = formatRecoveryCode(recoverySecret)
  vmk.fill(0)
  recoverySecret.fill(0)

  return {
    code,
    label: passkeyLabel(passkey.response.authenticatorAttachment),
    commit: () => $fetch('/api/v2/vault/setup/commit', {
      method: 'POST',
      body: { challengeId: options.challengeId, credential: passkey.response, label: passkeyLabel(passkey.response.authenticatorAttachment), prfInput: b64u(prfInput), recovery, ...wrapped },
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

/** A message for the owner from any error a flow can raise. */
export function flowError(err: unknown): string {
  if (err instanceof PasskeyError) return err.message
  const e = err as { data?: { title?: string, detail?: string }, message?: string }
  return [e.data?.title, e.data?.detail].filter(Boolean).join('. ') || e.message || 'Something went wrong.'
}
