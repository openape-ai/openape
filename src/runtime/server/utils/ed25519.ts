import type { KeyObject } from 'node:crypto'
import { createPublicKey, verify } from 'node:crypto'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function parseSSHEd25519PublicKey(sshKey: string): KeyObject {
  const parts = sshKey.trim().split(/\s+/)
  if (parts[0] !== 'ssh-ed25519' || !parts[1]) {
    throw new Error('Not an ssh-ed25519 key')
  }

  const wireFormat = Buffer.from(parts[1], 'base64')

  let offset = 0
  const typeLen = wireFormat.readUInt32BE(offset)
  offset += 4
  const keyType = wireFormat.subarray(offset, offset + typeLen).toString()
  offset += typeLen

  if (keyType !== 'ssh-ed25519') {
    throw new Error(`Unexpected key type in wire format: ${keyType}`)
  }

  const keyLen = wireFormat.readUInt32BE(offset)
  offset += 4
  const rawKey = wireFormat.subarray(offset, offset + keyLen)

  if (rawKey.length !== 32) {
    throw new Error(`Expected 32-byte ed25519 key, got ${rawKey.length}`)
  }

  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])

  return createPublicKey({
    key: spkiDer,
    format: 'der',
    type: 'spki',
  })
}

/**
 * Parse an SSH Ed25519 public key into a Node.js KeyObject.
 * The returned KeyObject is compatible with jose's KeyLike type
 * and can be used for EdDSA JWT verification.
 */
export function sshEd25519ToKeyObject(sshKey: string): KeyObject {
  return parseSSHEd25519PublicKey(sshKey)
}

export function verifyEd25519Signature(
  sshPublicKey: string,
  data: Buffer | string,
  signature: Buffer,
): boolean {
  const pubKey = parseSSHEd25519PublicKey(sshPublicKey)
  const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data
  return verify(null, dataBuffer, pubKey, signature)
}
