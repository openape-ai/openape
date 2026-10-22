/**
 * Vault cryptography, format v2 (plan section 11). WebCrypto only, so the same
 * module runs in the owner's browser, in Node tests and on the server.
 *
 * Key hierarchy: a passkey's PRF output → per-credential wrapping key → vault
 * master key (VMK) → one data key (DEK) per secret version. Every ciphertext is
 * bound to its exact context through AES-GCM additional data, and every HKDF
 * derivation uses the same context as `info`, so nothing opens anywhere else.
 */

export interface Sealed {
  iv: string
  ct: string
}

export interface SecretIds {
  vaultId: string
  secretId: string
  version: number
}

export interface SealedSecret {
  value: Sealed
  dek: Sealed
}

export interface DeliveryContext {
  approvalId: string
  consumerKeyFingerprint: string
  secretId: string
  version: number
}

/** A value sealed for one machine: the sender's ephemeral ECDH public key, IV and ciphertext. */
export interface DeliveryPackage {
  epk: string
  iv: string
  ct: string
}

export interface RecoveryRecord {
  recoverySalt: string
  vmkWrap: Sealed
  proofKeyWrap: Sealed
  proofPublicJwk: JsonWebKey
}

type Bytes = Uint8Array<ArrayBuffer>

const PREFIX = 'openape-secrets/v2'
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_BYTES = 32
const RECOVERY_CHARS = Math.ceil((RECOVERY_BYTES * 8) / 5)
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

const encoder = new TextEncoder()

function bytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))
}

export function b64u(data: ArrayBuffer | Bytes): string {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (const byte of view) s += String.fromCharCode(byte)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromB64u(value: string): Bytes {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Unambiguous context bytes: the format prefix, the purpose and every part,
 * each preceded by its byte length (4-byte big-endian). Identities may contain
 * any separator, so plain joining would let two contexts collide.
 */
export function ctx(purpose: string, ...parts: string[]): Bytes {
  const items = [PREFIX, purpose, ...parts].map(p => encoder.encode(p))
  const out = new Uint8Array(new ArrayBuffer(items.reduce((n, item) => n + 4 + item.length, 0)))
  const view = new DataView(out.buffer)
  let at = 0
  for (const item of items) {
    view.setUint32(at, item.length)
    out.set(item, at + 4)
    at += 4 + item.length
  }
  return out
}

async function hkdfAesKey(ikm: BufferSource, salt: BufferSource, info: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(key: CryptoKey, plaintext: Bytes, aad: Bytes): Promise<Sealed> {
  const iv = bytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext)
  return { iv: b64u(iv), ct: b64u(ct) }
}

async function decrypt(key: CryptoKey, sealed: Sealed, aad: Bytes): Promise<Bytes> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(sealed.iv), additionalData: aad }, key, fromB64u(sealed.ct))
  return new Uint8Array(pt)
}

/** The key that wraps the VMK for one passkey, derived from that passkey's PRF output. */
export function credentialKek(prfOutput: BufferSource, kdfSalt: BufferSource, vaultId: string, credentialId: string): Promise<CryptoKey> {
  return hkdfAesKey(prfOutput, kdfSalt, ctx('vmk-kek', vaultId, credentialId))
}

export function wrapVmk(kek: CryptoKey, vmk: Bytes, vaultId: string, credentialId: string): Promise<Sealed> {
  return encrypt(kek, vmk, ctx('vmk-wrap', vaultId, credentialId))
}

export function unwrapVmk(kek: CryptoKey, sealed: Sealed, vaultId: string, credentialId: string): Promise<Bytes> {
  return decrypt(kek, sealed, ctx('vmk-wrap', vaultId, credentialId))
}

export function newVmk(): Bytes {
  return bytes(32)
}

/** Encrypt one secret version under a fresh DEK, and the DEK under the VMK. */
export async function sealSecret(vmk: Bytes, plaintext: string, ids: SecretIds): Promise<SealedSecret> {
  const parts = [ids.vaultId, ids.secretId, String(ids.version)]
  const dek = bytes(32)
  const value = await encrypt(await aesKey(dek), encoder.encode(plaintext), ctx('secret-value', ...parts))
  const wrapped = await encrypt(await aesKey(vmk), dek, ctx('dek-wrap', ...parts))
  dek.fill(0)
  return { value, dek: wrapped }
}

export async function openSecret(vmk: Bytes, sealed: SealedSecret, ids: SecretIds): Promise<string> {
  const parts = [ids.vaultId, ids.secretId, String(ids.version)]
  const dek = await decrypt(await aesKey(vmk), sealed.dek, ctx('dek-wrap', ...parts))
  const value = await decrypt(await aesKey(dek), sealed.value, ctx('secret-value', ...parts))
  dek.fill(0)
  return new TextDecoder().decode(value)
}

export function newRecoverySecret(): Bytes {
  return bytes(RECOVERY_BYTES)
}

/** 32 bytes as 52 Crockford base32 characters in groups of four. */
export function formatRecoveryCode(secret: Bytes): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const byte of secret) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join(' ') // 52 chars always yield 13 groups
}

/** Read a typed recovery code back, forgiving case, separators and Crockford look-alikes. */
export function parseRecoveryCode(code: string): Bytes {
  const chars = code.toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replaceAll('I', '1').replaceAll('L', '1')
  if (chars.length !== RECOVERY_CHARS) throw new Error(`Recovery code must have ${RECOVERY_CHARS} characters`)
  const out = new Uint8Array(new ArrayBuffer(RECOVERY_BYTES))
  let bits = 0
  let acc = 0
  let at = 0
  for (const c of chars) {
    const v = CROCKFORD.indexOf(c)
    if (v < 0) throw new Error(`Recovery code contains an invalid character: ${c}`)
    acc = ((acc << 5) | v) & 0xFFF
    bits += 5
    if (bits >= 8) {
      out[at++] = (acc >> (bits - 8)) & 0xFF
      bits -= 8
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) throw new Error('Recovery code is not valid')
  return out
}

async function recoveryKek(secret: Bytes, salt: Bytes, vaultId: string): Promise<CryptoKey> {
  return hkdfAesKey(secret, salt, ctx('recovery-kek', vaultId))
}

/** Wrap the VMK for the recovery secret and create the key that proves its possession. */
export async function createRecovery(vmk: Bytes, secret: Bytes, vaultId: string): Promise<RecoveryRecord> {
  const salt = bytes(32)
  const kek = await recoveryKek(secret, salt, vaultId)
  const proof = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', proof.privateKey))
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', proof.publicKey)
  const [vmkWrap, proofKeyWrap] = await Promise.all([
    encrypt(kek, vmk, ctx('vmk-recovery-wrap', vaultId)),
    encrypt(kek, pkcs8, ctx('recovery-proof-key', vaultId)),
  ])
  pkcs8.fill(0)
  return { recoverySalt: b64u(salt), vmkWrap, proofKeyWrap, proofPublicJwk: { kty, crv, x, y } }
}

export async function openRecovery(secret: Bytes, record: RecoveryRecord, vaultId: string): Promise<{ vmk: Bytes, sign: (challenge: string) => Promise<string> }> {
  const kek = await recoveryKek(secret, fromB64u(record.recoverySalt), vaultId)
  const [vmk, pkcs8] = await Promise.all([
    decrypt(kek, record.vmkWrap, ctx('vmk-recovery-wrap', vaultId)),
    decrypt(kek, record.proofKeyWrap, ctx('recovery-proof-key', vaultId)),
  ])
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, ECDSA, false, ['sign'])
  pkcs8.fill(0)
  return {
    vmk,
    sign: async challenge => b64u(await crypto.subtle.sign(SIGN, key, ctx('recovery-proof', challenge))),
  }
}

export async function verifyRecoveryProof(publicJwk: JsonWebKey, challenge: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', publicJwk, ECDSA, false, ['verify'])
  return crypto.subtle.verify(SIGN, key, fromB64u(signature), ctx('recovery-proof', challenge))
}

/** RFC 7638 JWK thumbprint of a P-256 public key, as upper-case hex. */
export async function keyFingerprint(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('Expected a P-256 public key')
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function deliveryCtx(c: DeliveryContext): Bytes {
  return ctx('delivery', c.approvalId, c.consumerKeyFingerprint, c.secretId, String(c.version))
}

async function deliveryKey(privateKey: CryptoKey, publicKey: CryptoKey, c: DeliveryContext): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  return hkdfAesKey(shared, new Uint8Array(new ArrayBuffer(0)), deliveryCtx(c))
}

/**
 * Seal a value for exactly the machine an approval names. Refuses any key whose
 * fingerprint is not the approved one, so a swapped key cannot receive it.
 */
export async function sealDelivery(consumerPublicJwk: JsonWebKey, plaintext: string, c: DeliveryContext): Promise<DeliveryPackage> {
  if (await keyFingerprint(consumerPublicJwk) !== c.consumerKeyFingerprint) throw new Error('Machine key does not match the approved fingerprint')
  const recipient = await crypto.subtle.importKey('jwk', consumerPublicJwk, ECDH, false, [])
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const sealed = await encrypt(await deliveryKey(ephemeral.privateKey, recipient, c), encoder.encode(plaintext), deliveryCtx(c))
  return { epk: b64u(await crypto.subtle.exportKey('raw', ephemeral.publicKey)), ...sealed }
}

/** Open a delivery package with the machine's private key, in the exact approval context. */
export async function openDelivery(consumerPrivateJwk: JsonWebKey, pkg: DeliveryPackage, c: DeliveryContext): Promise<string> {
  const priv = await crypto.subtle.importKey('jwk', consumerPrivateJwk, ECDH, false, ['deriveBits'])
  const epk = await crypto.subtle.importKey('raw', fromB64u(pkg.epk), ECDH, false, [])
  const value = await decrypt(await deliveryKey(priv, epk, c), pkg, deliveryCtx(c))
  return new TextDecoder().decode(value)
}

/** The vault's signing key: public half in the clear, private half wrapped under the VMK. */
export interface SigningKeyRecord {
  publicJwk: JsonWebKey
  keyWrap: Sealed
}

/** Where a package was made: its delivery context plus the vault that signs it. */
export type SignedDeliveryContext = DeliveryContext & { vaultId: string }

function deliverySignatureInput(pkg: DeliveryPackage, c: SignedDeliveryContext): Bytes {
  return ctx('delivery-signature', c.vaultId, c.approvalId, c.consumerKeyFingerprint, c.secretId, String(c.version), pkg.epk, pkg.iv, pkg.ct)
}

/**
 * Create the key that signs every package this vault hands out, so a machine
 * can tell a vault-made package from one a compromised server slipped in.
 */
export async function createSigningKey(vmk: Bytes, vaultId: string): Promise<SigningKeyRecord> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const keyWrap = await encrypt(await aesKey(vmk), pkcs8, ctx('vault-signing-key', vaultId))
  pkcs8.fill(0)
  return { publicJwk: { kty, crv, x, y }, keyWrap }
}

/** Unwrap the signing key for one approval; the result can only sign. */
export async function openSigningKey(vmk: Bytes, record: Pick<SigningKeyRecord, 'keyWrap'>, vaultId: string): Promise<CryptoKey> {
  const pkcs8 = await decrypt(await aesKey(vmk), record.keyWrap, ctx('vault-signing-key', vaultId))
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, ECDSA, false, ['sign'])
  pkcs8.fill(0)
  return key
}

export async function signDelivery(signingKey: CryptoKey, pkg: DeliveryPackage, c: SignedDeliveryContext): Promise<string> {
  return b64u(await crypto.subtle.sign(SIGN, signingKey, deliverySignatureInput(pkg, c)))
}

export async function verifyDelivery(publicJwk: JsonWebKey, pkg: DeliveryPackage, c: SignedDeliveryContext, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('jwk', publicJwk, ECDSA, false, ['verify'])
  return crypto.subtle.verify(SIGN, key, fromB64u(signature), deliverySignatureInput(pkg, c))
}
