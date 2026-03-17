import { Buffer } from 'node:buffer'
import type { KeyObject } from 'node:crypto'
import { createPrivateKey } from 'node:crypto'

const OPENSSH_MAGIC = 'openssh-key-v1\0'

/**
 * Parse an OpenSSH Ed25519 private key file and return a Node.js KeyObject.
 * Supports both OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----)
 * and PKCS8 PEM format (-----BEGIN PRIVATE KEY-----).
 */
export function loadEd25519PrivateKey(pem: string): KeyObject {
  if (pem.includes('BEGIN OPENSSH PRIVATE KEY')) {
    return parseOpenSSHEd25519(pem)
  }
  // PKCS8 PEM — Node.js handles this natively
  return createPrivateKey(pem)
}

function parseOpenSSHEd25519(pem: string): KeyObject {
  const b64 = pem
    .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/, '')
    .replace(/-----END OPENSSH PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const buf = Buffer.from(b64, 'base64')
  let offset = 0

  // Verify magic
  const magic = buf.subarray(0, OPENSSH_MAGIC.length).toString('ascii')
  if (magic !== OPENSSH_MAGIC) {
    throw new Error('Not an OpenSSH private key')
  }
  offset += OPENSSH_MAGIC.length

  // ciphername
  const cipherLen = buf.readUInt32BE(offset); offset += 4
  const cipher = buf.subarray(offset, offset + cipherLen).toString(); offset += cipherLen
  if (cipher !== 'none') {
    throw new Error(`Encrypted keys not supported (cipher: ${cipher}). Decrypt first with: ssh-keygen -p -f <key>`)
  }

  // kdfname
  const kdfLen = buf.readUInt32BE(offset); offset += 4
  offset += kdfLen // skip kdf

  // kdfoptions
  const kdfOptsLen = buf.readUInt32BE(offset); offset += 4
  offset += kdfOptsLen // skip

  // number of keys
  const numKeys = buf.readUInt32BE(offset); offset += 4
  if (numKeys !== 1) {
    throw new Error(`Expected 1 key, got ${numKeys}`)
  }

  // public key section (skip)
  const pubSectionLen = buf.readUInt32BE(offset); offset += 4
  offset += pubSectionLen

  // private key section
  const privSectionLen = buf.readUInt32BE(offset); offset += 4
  const privSection = buf.subarray(offset, offset + privSectionLen)
  let pOffset = 0

  // check integers (must match)
  const check1 = privSection.readUInt32BE(pOffset); pOffset += 4
  const check2 = privSection.readUInt32BE(pOffset); pOffset += 4
  if (check1 !== check2) {
    throw new Error('Check integers mismatch — key may be corrupted or encrypted')
  }

  // keytype string
  const keyTypeLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const keyType = privSection.subarray(pOffset, pOffset + keyTypeLen).toString(); pOffset += keyTypeLen
  if (keyType !== 'ssh-ed25519') {
    throw new Error(`Expected ssh-ed25519, got ${keyType}`)
  }

  // public key (32 bytes, prefixed with length)
  const pubKeyLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const pubKey = privSection.subarray(pOffset, pOffset + pubKeyLen); pOffset += pubKeyLen

  // private key (64 bytes = 32-byte seed + 32-byte pubkey, prefixed with length)
  const privKeyLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const privKeyData = privSection.subarray(pOffset, pOffset + privKeyLen)

  const seed = privKeyData.subarray(0, 32) // Ed25519 seed

  // Import as JWK
  const d = seed.toString('base64url')
  const x = pubKey.toString('base64url')

  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d, x },
    format: 'jwk',
  })
}
