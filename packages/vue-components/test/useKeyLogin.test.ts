import { describe, expect, it } from 'vitest'
import { extractEd25519FromOpenSSH, readUint32, wrapEd25519AsPKCS8 } from '../src/composables/useKeyLogin'

describe('readUint32', () => {
  it('reads big-endian uint32 from byte array', () => {
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x07])
    expect(readUint32(data, 0)).toBe(7)
  })

  it('reads uint32 at offset', () => {
    const data = new Uint8Array([0xFF, 0xFF, 0x00, 0x00, 0x01, 0x00])
    expect(readUint32(data, 2)).toBe(256)
  })

  it('handles large values', () => {
    // 0x01020304 = 16909060
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    expect(readUint32(data, 0)).toBe(16909060)
  })
})

describe('wrapEd25519AsPKCS8', () => {
  it('produces correct PKCS8 envelope length', () => {
    const seed = new Uint8Array(32).fill(0xAB)
    const pkcs8 = wrapEd25519AsPKCS8(seed)
    // PKCS8 prefix is 16 bytes + 32 byte seed = 48 bytes
    expect(pkcs8.length).toBe(48)
  })

  it('starts with correct PKCS8 DER prefix', () => {
    const seed = new Uint8Array(32).fill(0x42)
    const pkcs8 = wrapEd25519AsPKCS8(seed)
    // SEQUENCE tag
    expect(pkcs8[0]).toBe(0x30)
    // Total length (46 = 0x2e)
    expect(pkcs8[1]).toBe(0x2E)
    // Ed25519 OID: 1.3.101.112 encoded as 06 03 2b 65 70
    expect(pkcs8[7]).toBe(0x06)
    expect(pkcs8[8]).toBe(0x03)
    expect(pkcs8[9]).toBe(0x2B)
    expect(pkcs8[10]).toBe(0x65)
    expect(pkcs8[11]).toBe(0x70)
  })

  it('embeds the seed at the end', () => {
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = i
    const pkcs8 = wrapEd25519AsPKCS8(seed)
    const embedded = pkcs8.slice(16, 48)
    expect(embedded).toEqual(seed)
  })
})

describe('extractEd25519FromOpenSSH', () => {
  it('extracts 32-byte seed from a real OpenSSH key', () => {
    // Real ed25519 key generated with ssh-keygen for testing.
    const pem = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
      'QyNTUxOQAAACAE2/vRyMyxUr7PIx6vaa/uIiSlExVRSaepU5efXHLSRgAAAIgheoahIXqG',
      'oQAAAAtzc2gtZWQyNTUxOQAAACAE2/vRyMyxUr7PIx6vaa/uIiSlExVRSaepU5efXHLSRg',
      'AAAEDGxXVH1mhjCnRmp2Z97dhIMYykQY8PjJOVD2kfeGS/HgTb+9HIzLFSvs8jHq9pr+4i',
      'JKUTFVFJp6lTl59cctJGAAAABHRlc3QB',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')

    // Decode the base64 body
    const match = pem.match(/-----BEGIN OPENSSH PRIVATE KEY-----\n?([\s\S]+?)\n?-----END OPENSSH PRIVATE KEY-----/)
    expect(match).not.toBeNull()
    const decoded = Uint8Array.from(atob(match![1]!.replace(/\s/g, '')), c => c.charCodeAt(0))

    const seed = extractEd25519FromOpenSSH(decoded)
    expect(seed.length).toBe(32)
    // Seed should not be all zeros
    expect(seed.some(b => b !== 0)).toBe(true)
  })

  it('extracts a seed that can be wrapped as PKCS8', () => {
    // Minimal valid openssh-key-v1 structure for ed25519 (unencrypted)
    const parts: number[] = []

    // Magic: "openssh-key-v1\0"
    const magic = new TextEncoder().encode('openssh-key-v1\0')
    parts.push(...magic)

    // cipher: "none"
    const none = new TextEncoder().encode('none')
    pushString(parts, none)
    // kdf: "none"
    pushString(parts, none)
    // kdf options: empty
    pushString(parts, new Uint8Array(0))
    // number of keys: 1
    pushUint32(parts, 1)

    // Public key blob: "ssh-ed25519" + 32 bytes pubkey
    const pubkey = new Uint8Array(32).fill(0xAA)
    const pubBlob: number[] = []
    const sshEd = new TextEncoder().encode('ssh-ed25519')
    pushString(pubBlob, sshEd)
    pushString(pubBlob, pubkey)
    pushString(parts, new Uint8Array(pubBlob))

    // Private section
    const privSection: number[] = []
    // checkint x2 (same random value)
    pushUint32(privSection, 0x12345678)
    pushUint32(privSection, 0x12345678)
    // key type
    pushString(privSection, sshEd)
    // public key
    pushString(privSection, pubkey)
    // private key: 64 bytes (32 seed + 32 pubkey)
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = i
    const privKey = new Uint8Array(64)
    privKey.set(seed, 0)
    privKey.set(pubkey, 32)
    pushString(privSection, privKey)
    // padding
    pushString(parts, new Uint8Array(privSection))

    const data = new Uint8Array(parts)
    const extracted = extractEd25519FromOpenSSH(data)
    expect(extracted.length).toBe(32)
    expect(extracted).toEqual(seed)

    // Verify PKCS8 wrapping
    const pkcs8 = wrapEd25519AsPKCS8(extracted)
    expect(pkcs8.length).toBe(48)
  })
})

// Helpers to build openssh binary format
function pushUint32(arr: number[], val: number) {
  arr.push((val >>> 24) & 0xFF, (val >>> 16) & 0xFF, (val >>> 8) & 0xFF, val & 0xFF)
}

function pushString(arr: number[], data: Uint8Array) {
  pushUint32(arr, data.length)
  arr.push(...data)
}
