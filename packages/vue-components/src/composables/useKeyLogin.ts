import { ref } from 'vue'

/**
 * Read a big-endian uint32 from a Uint8Array at the given offset.
 */
export function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!
}

/**
 * Extract the 32-byte ed25519 seed from an OpenSSH private key blob.
 *
 * OpenSSH format layout:
 *   "openssh-key-v1\0" magic (15 bytes)
 *   cipher name (string), kdf name (string), kdf options (string)
 *   number of keys (uint32)
 *   public key blob (string)
 *   private section (string) containing:
 *     checkint x2 (8 bytes)
 *     key type string "ssh-ed25519"
 *     public key (32 bytes with length prefix)
 *     private key (64 bytes with length prefix: 32 seed + 32 public)
 */
export function extractEd25519FromOpenSSH(data: Uint8Array): Uint8Array {
  // Skip: magic "openssh-key-v1\0" (15 bytes)
  let offset = 15

  // Skip cipher name (string)
  const cipherLen = readUint32(data, offset)
  offset += 4 + cipherLen
  // Skip kdf name
  const kdfLen = readUint32(data, offset)
  offset += 4 + kdfLen
  // Skip kdf options
  const kdfOptsLen = readUint32(data, offset)
  offset += 4 + kdfOptsLen
  // Number of keys
  offset += 4
  // Skip public key blob
  const pubBlobLen = readUint32(data, offset)
  offset += 4 + pubBlobLen
  // Private section length
  const _privLen = readUint32(data, offset)
  offset += 4
  // Skip checkint (2x uint32)
  offset += 8
  // Skip key type string "ssh-ed25519"
  const typeLen = readUint32(data, offset)
  offset += 4 + typeLen
  // Skip public key (32 bytes with length prefix)
  const pubLen = readUint32(data, offset)
  offset += 4 + pubLen
  // Private key: length prefix + 64 bytes (seed + public)
  const _privKeyLen = readUint32(data, offset)
  offset += 4
  // First 32 bytes = seed (the actual private key)
  return data.slice(offset, offset + 32)
}

/**
 * Wrap a raw 32-byte ed25519 seed in a PKCS8 DER envelope.
 *
 * PKCS8 structure for Ed25519:
 *   SEQUENCE {
 *     INTEGER 0
 *     SEQUENCE { OID 1.3.101.112 }
 *     OCTET STRING { OCTET STRING { 32-byte seed } }
 *   }
 */
export function wrapEd25519AsPKCS8(seed: Uint8Array): Uint8Array {
  const prefix = new Uint8Array([
    0x30, 0x2E, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20,
  ])
  const result = new Uint8Array(prefix.length + seed.length)
  result.set(prefix)
  result.set(seed, prefix.length)
  return result
}

/**
 * Composable for ed25519 key-based login via Web Crypto API.
 *
 * Flow:
 * 1. Parse PEM private key (PKCS8 or OpenSSH format)
 * 2. Request challenge from IdP
 * 3. Sign challenge with Web Crypto Ed25519
 * 4. Authenticate with signature (sets session cookie)
 */
export function useKeyLogin(idpBaseUrl: string = '') {
  const loading = ref(false)
  const error = ref('')

  /**
   * Parse an ed25519 private key from PEM format into a CryptoKey.
   * Supports both PKCS8 PEM and OpenSSH PRIVATE KEY formats.
   */
  async function importPrivateKey(pem: string): Promise<CryptoKey> {
    // Try PKCS8 first
    const pkcs8Match = pem.match(/-----BEGIN PRIVATE KEY-----\n?([\s\S]+?)\n?-----END PRIVATE KEY-----/)
    if (pkcs8Match) {
      const binaryDer = Uint8Array.from(atob(pkcs8Match[1]!.replace(/\s/g, '')), c => c.charCodeAt(0))
      return crypto.subtle.importKey('pkcs8', binaryDer.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['sign'])
    }

    // Try OpenSSH format
    const opensshMatch = pem.match(/-----BEGIN OPENSSH PRIVATE KEY-----\n?([\s\S]+?)\n?-----END OPENSSH PRIVATE KEY-----/)
    if (opensshMatch) {
      const decoded = Uint8Array.from(atob(opensshMatch[1]!.replace(/\s/g, '')), c => c.charCodeAt(0))
      const rawKey = extractEd25519FromOpenSSH(decoded)
      const pkcs8 = wrapEd25519AsPKCS8(rawKey)
      return crypto.subtle.importKey('pkcs8', pkcs8.buffer as ArrayBuffer, { name: 'Ed25519' }, false, ['sign'])
    }

    throw new Error('Unsupported key format. Expected PEM-encoded PKCS8 or OpenSSH ed25519 private key.')
  }

  /**
   * Login with an ed25519 private key:
   * 1. Request challenge from IdP
   * 2. Sign challenge in browser via Web Crypto
   * 3. Authenticate with signature — session cookie set
   */
  async function loginWithKey(email: string, privateKeyPem: string): Promise<boolean> {
    loading.value = true
    error.value = ''

    try {
      const key = await importPrivateKey(privateKeyPem)

      // 1. Request challenge
      const challengeRes = await fetch(`${idpBaseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: email }),
      })
      if (!challengeRes.ok) {
        const err = await challengeRes.json().catch(() => ({}))
        throw new Error((err as Record<string, string>).title || `Challenge failed: ${challengeRes.status}`)
      }
      const { challenge } = await challengeRes.json() as { challenge: string }

      // 2. Sign challenge with Web Crypto
      const challengeBytes = new TextEncoder().encode(challenge)
      const signatureBytes = await crypto.subtle.sign('Ed25519', key, challengeBytes)
      const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))

      // 3. Authenticate (session login — sets cookie)
      const authRes = await fetch(`${idpBaseUrl}/api/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: email, challenge, signature }),
      })
      if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({}))
        throw new Error((err as Record<string, string>).title || `Authentication failed: ${authRes.status}`)
      }

      return true
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : 'Login failed'
      return false
    }
    finally {
      loading.value = false
    }
  }

  return { loginWithKey, importPrivateKey, loading, error }
}
