import { Buffer } from 'node:buffer'
import { createPrivateKey  } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

const OPENSSH_MAGIC = 'openssh-key-v1\0'

/**
 * Parse an OpenSSH Ed25519 private key file and return a Node.js KeyObject.
 *
 * Supports both OpenSSH format (`-----BEGIN OPENSSH PRIVATE KEY-----`)
 * and PKCS8 PEM format (`-----BEGIN PRIVATE KEY-----`). Mirrors the
 * loader in `@openape/apes` — duplicated here so cli-auth can do its
 * own challenge-response refresh without taking an apes dependency.
 */
export function loadEd25519PrivateKey(pem: string): KeyObject {
  if (pem.includes('BEGIN OPENSSH PRIVATE KEY')) {
    return parseOpenSSHEd25519(pem)
  }
  return createPrivateKey(pem)
}

function parseOpenSSHEd25519(pem: string): KeyObject {
  const b64 = pem
    .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/, '')
    .replace(/-----END OPENSSH PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const buf = Buffer.from(b64, 'base64')
  let offset = 0

  const magic = buf.subarray(0, OPENSSH_MAGIC.length).toString('ascii')
  if (magic !== OPENSSH_MAGIC) {
    throw new Error('Not an OpenSSH private key')
  }
  offset += OPENSSH_MAGIC.length

  const cipherLen = buf.readUInt32BE(offset); offset += 4
  const cipher = buf.subarray(offset, offset + cipherLen).toString(); offset += cipherLen
  if (cipher !== 'none') {
    throw new Error(`Encrypted keys not supported (cipher: ${cipher}). Decrypt first with: ssh-keygen -p -f <key>`)
  }

  const kdfLen = buf.readUInt32BE(offset); offset += 4
  offset += kdfLen

  const kdfOptsLen = buf.readUInt32BE(offset); offset += 4
  offset += kdfOptsLen

  const numKeys = buf.readUInt32BE(offset); offset += 4
  if (numKeys !== 1) {
    throw new Error(`Expected 1 key, got ${numKeys}`)
  }

  const pubSectionLen = buf.readUInt32BE(offset); offset += 4
  offset += pubSectionLen

  const privSectionLen = buf.readUInt32BE(offset); offset += 4
  const privSection = buf.subarray(offset, offset + privSectionLen)
  let pOffset = 0

  const check1 = privSection.readUInt32BE(pOffset); pOffset += 4
  const check2 = privSection.readUInt32BE(pOffset); pOffset += 4
  if (check1 !== check2) {
    throw new Error('Check integers mismatch — key may be corrupted or encrypted')
  }

  const keyTypeLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const keyType = privSection.subarray(pOffset, pOffset + keyTypeLen).toString(); pOffset += keyTypeLen
  if (keyType !== 'ssh-ed25519') {
    throw new Error(`Expected ssh-ed25519, got ${keyType}`)
  }

  const pubKeyLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const pubKey = privSection.subarray(pOffset, pOffset + pubKeyLen); pOffset += pubKeyLen

  const privKeyLen = privSection.readUInt32BE(pOffset); pOffset += 4
  const privKeyData = privSection.subarray(pOffset, pOffset + privKeyLen)

  const seed = privKeyData.subarray(0, 32)

  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: seed.toString('base64url'), x: pubKey.toString('base64url') },
    format: 'jwk',
  })
}
