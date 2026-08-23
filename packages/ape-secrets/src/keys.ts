import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'

/**
 * The private key never leaves this machine — that is the whole arrangement.
 * It is generated here, only the public half is registered, and the file is
 * written 0600. Whoever compromises the service gets envelopes and no keys.
 */
const KEY_DIR = join(homedir(), '.config', 'apes', 'secrets')

export interface ConsumerKey {
  consumerId: string
  name: string
  privateJwk: JsonWebKey
}

export function keyPath(consumerId: string): string {
  return join(KEY_DIR, `${consumerId}.json`)
}

export async function generateKeyPair(): Promise<{ publicJwk: JsonWebKey, privateJwk: JsonWebKey }> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey
  // key_ops/ext are local bookkeeping; the service validates a bare public JWK.
  delete publicJwk.key_ops
  delete publicJwk.ext
  return { publicJwk, privateJwk }
}

export function saveKey(key: ConsumerKey): string {
  const path = keyPath(key.consumerId)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(key, null, 2))
  chmodSync(path, 0o600)
  return path
}

export function loadKey(consumerId: string): ConsumerKey {
  const path = keyPath(consumerId)
  if (!existsSync(path)) {
    throw new Error(`No private key for consumer ${consumerId} on this machine (${path}). Run \`ape-secrets keygen\` here, or collect on the machine that owns the key.`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as ConsumerKey
}

export interface SealedBox { epk: string, salt: string, iv: string, ct: string }

/** Open an envelope with this machine's private key. Mirrors the browser's `seal`. */
export async function openBox(privateJwk: JsonWebKey, box: SealedBox): Promise<string> {
  const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
  const priv = await webcrypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const epk = await webcrypto.subtle.importKey('raw', b64(box.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256)
  const base = await webcrypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: b64(box.salt), info: new TextEncoder().encode('openape-secret-gate/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct))
  return new TextDecoder().decode(pt)
}
