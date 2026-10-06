import { webcrypto } from 'node:crypto'

/**
 * The envelope of OpenApe Secrets: ECDH (P-256) → HKDF-SHA256 → AES-GCM, the same WebCrypto path
 * the owner's browser seals with (`apps/openape-secrets/app/utils/seal.ts`). Only the holder of
 * the consumer's private key can open it; the service in the middle cannot.
 */
export interface SealedBox { epk: string, salt: string, iv: string, ct: string }
const INFO = 'openape-secret-gate/v1'
const subtle = webcrypto.subtle
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, 'base64'))
async function aesKey(shared: ArrayBuffer, salt: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(INFO) }, base, { name: 'AES-GCM', length: 256 }, false, [usage])
}

export async function generateConsumerKey(): Promise<{ publicJwk: JsonWebKey, privateJwk: JsonWebKey }> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return { publicJwk: await subtle.exportKey('jwk', pair.publicKey), privateJwk: await subtle.exportKey('jwk', pair.privateKey) }
}

export function isSealedBox(value: unknown): value is SealedBox {
  if (!value || typeof value !== 'object') return false
  const box = value as Record<string, unknown>
  return (['epk', 'salt', 'iv', 'ct'] as const).every(key => typeof box[key] === 'string' && (box[key] as string).length > 0)
}

export async function openBox(privateJwk: JsonWebKey, box: SealedBox): Promise<string> {
  const priv = await subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const epk = await subtle.importKey('raw', bytes(box.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256)
  const key = await aesKey(shared, bytes(box.salt), 'decrypt')
  return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) }, key, bytes(box.ct)))
}

/** The browser's side, kept here so the collecting path is tested against the real algorithm. */
export async function sealBox(publicJwk: JsonWebKey, plaintext: string): Promise<SealedBox> {
  const recipient = await subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256)
  const salt = webcrypto.getRandomValues(new Uint8Array(32)); const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(shared, salt, 'encrypt')
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  const base64 = (value: ArrayBuffer | Uint8Array) => Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64')
  return { epk: base64(await subtle.exportKey('raw', ephemeral.publicKey)), salt: base64(salt), iv: base64(iv), ct: base64(ct) }
}
