/**
 * Sealing a value for exactly one machine.
 *
 * ECDH(P-256) → HKDF-SHA256 → AES-GCM, all of it WebCrypto, no dependency.
 * The sender makes a throwaway key pair, derives a shared secret with the
 * recipient's public key, and throws its own private half away. What travels is
 * the ephemeral public key, a salt, an IV and the ciphertext — four pieces that
 * are useless without the recipient's private key, which never leaves that
 * machine. The service in the middle stores them and cannot open them.
 *
 * P-256 rather than X25519 on purpose: the filling happens in whatever browser
 * the owner has in hand, usually Safari on a phone, and P-256 ECDH has been in
 * WebCrypto everywhere for years. The code is the same either way — only the
 * algorithm name differs — so there is nothing to win by picking the newer curve
 * and a compatibility question to lose.
 */

export interface SealedBox {
  epk: string
  salt: string
  iv: string
  ct: string
}

const INFO = 'openape-secret-gate/v1'

// Both helpers pin the buffer type. TypeScript distinguishes a Uint8Array over
// a plain ArrayBuffer from one over ArrayBufferLike (which may be shared), and
// WebCrypto only accepts the former — building on an explicit ArrayBuffer keeps
// that true without a cast.
function toBase64(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const byte of b) s += String.fromCharCode(byte)
  return btoa(s)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function aesKey(sharedBits: ArrayBuffer, salt: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

/** Seal `plaintext` so that only the holder of the recipient's private key can read it. */
export async function seal(recipientPublicJwk: JsonWebKey, plaintext: string): Promise<SealedBox> {
  const recipient = await crypto.subtle.importKey('jwk', recipientPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256)

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)))
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const key = await aesKey(shared, salt, 'encrypt')
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))

  return {
    epk: toBase64(await crypto.subtle.exportKey('raw', ephemeral.publicKey)),
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ct),
  }
}

/**
 * Open a sealed box with the recipient's private key. Lives next to `seal` so
 * the pair is read and tested together; the collecting CLI (M4) uses this one.
 */
export async function open(recipientPrivateJwk: JsonWebKey, box: SealedBox): Promise<string> {
  const priv = await crypto.subtle.importKey('jwk', recipientPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const epk = await crypto.subtle.importKey('raw', fromBase64(box.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256)
  const key = await aesKey(shared, fromBase64(box.salt), 'decrypt')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.ct))
  return new TextDecoder().decode(pt)
}
