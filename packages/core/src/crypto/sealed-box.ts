import type { KeyObject } from 'node:crypto'
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

// Anonymous sealed box: encrypt a secret to a recipient's long-term X25519
// public key so only the holder of the matching private key can open it.
// Pure node:crypto (X25519 ECDH → HKDF-SHA256 → AES-256-GCM); no external
// dependency. Used by troop to seal agent secrets at rest / in transit and
// by the agent runtime to open them. The agent is the only place plaintext
// exists. See plans.openape.ai 01KRTAE8 (M2a).

const HKDF_INFO = new TextEncoder().encode('openape-sealed-box-v1')
const IV_LEN = 12
const TAG_LEN = 16
const RAW_KEY_LEN = 32

export interface SealedBox {
  v: 1
  /** Ephemeral X25519 public key, raw 32 bytes, base64url. */
  epk: string
  /** AES-GCM IV, base64url. */
  iv: string
  /** Ciphertext, base64url. */
  ct: string
  /** AES-GCM auth tag, base64url. */
  tag: string
}

export interface X25519KeyPair {
  /** SPKI DER, base64url — self-contained, safe to publish. */
  publicKey: string
  /** PKCS8 DER, base64url — self-contained, keep secret. */
  privateKey: string
}

function b64u(data: Uint8Array): string {
  return Buffer.from(data).toString('base64url')
}

function unb64u(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

/** Raw 32-byte X25519 public key of a public-or-private KeyObject. */
function rawPub(key: KeyObject): Buffer {
  const pub = key.type === 'private' ? createPublicKey(key) : key
  const jwk = pub.export({ format: 'jwk' }) as { x: string }
  return unb64u(jwk.x)
}

function ephPublicFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: b64u(raw) },
    format: 'jwk',
  })
}

function deriveKey(shared: Buffer, ephPubRaw: Buffer, recipPubRaw: Buffer): Buffer {
  const salt = Buffer.concat([ephPubRaw, recipPubRaw])
  return Buffer.from(hkdfSync('sha256', shared, salt, HKDF_INFO, 32))
}

/** Generate a fresh long-term X25519 key pair for a recipient (the agent). */
export function generateX25519KeyPair(): X25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })),
    privateKey: b64u(privateKey.export({ type: 'pkcs8', format: 'der' })),
  }
}

/** Seal a message to the recipient's public key (SPKI DER, base64url). */
export function seal(plaintext: string | Uint8Array, recipientPublicKey: string): SealedBox {
  const recipPub = createPublicKey({ key: unb64u(recipientPublicKey), format: 'der', type: 'spki' })
  const eph = generateKeyPairSync('x25519')
  const ephPubRaw = rawPub(eph.publicKey)
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipPub })
  const key = deriveKey(shared, ephPubRaw, rawPub(recipPub))

  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext)
  const ct = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()

  return { v: 1, epk: b64u(ephPubRaw), iv: b64u(iv), ct: b64u(ct), tag: b64u(tag) }
}

/** Open a sealed box with the recipient's private key (PKCS8 DER, base64url). Throws if tampered or wrong key. */
export function open(box: SealedBox, recipientPrivateKey: string): Uint8Array {
  if (box.v !== 1) throw new Error(`unsupported sealed-box version: ${box.v}`)
  const epkRaw = unb64u(box.epk)
  if (epkRaw.length !== RAW_KEY_LEN) throw new Error('invalid ephemeral public key length')
  const iv = unb64u(box.iv)
  if (iv.length !== IV_LEN) throw new Error('invalid IV length')
  const tag = unb64u(box.tag)
  if (tag.length !== TAG_LEN) throw new Error('invalid auth tag length')

  const recipPriv = createPrivateKey({ key: unb64u(recipientPrivateKey), format: 'der', type: 'pkcs8' })
  const ephPub = ephPublicFromRaw(epkRaw)
  const shared = diffieHellman({ privateKey: recipPriv, publicKey: ephPub })
  const key = deriveKey(shared, epkRaw, rawPub(recipPriv))

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(unb64u(box.ct)), decipher.final()])
}

/** Open a sealed box and decode the plaintext as UTF-8. */
export function openString(box: SealedBox, recipientPrivateKey: string): string {
  return Buffer.from(open(box, recipientPrivateKey)).toString('utf8')
}
